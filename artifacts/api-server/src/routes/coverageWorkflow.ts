import { Router } from "express";
import { z } from "zod/v4";
import {
  pool,
  db,
  workforceCoverageResolutionsTable,
  workHubShiftRequestsTable,
} from "@workspace/db";
import { createHash } from "node:crypto";
import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { executeWorkHubCommand } from "../work-hub/commands";
import { appendWorkHubAudit } from "../work-hub/audit";
import {
  gateAssignmentTransactionClient,
  guardGateShiftAssignments,
  lockShiftSchedulingRows,
} from "../services/gate-shift-assignment";
import { validateScheduleRange } from "../work-hub/site-schedule-policy";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
const router = Router();
async function actor(
  req: Parameters<typeof getSessionFromRequest>[0],
  admin = false,
) {
  const raw = getSessionFromRequest(req);
  if (!raw?.userId) throw Object.assign(Error(), { status: 403 });
  const s = await validateAssistantSession(raw, db);
  if (
    !s?.userId ||
    !s.vendorId ||
    s.publicDemo ||
    s.managedSubcontractor ||
    (admin && s.membershipRole !== "admin")
  )
    throw Object.assign(Error("Current vendor access required"), {
      status: 403,
    });
  return s;
}
function failure(res: import("express").Response, e: unknown) {
  if (e instanceof z.ZodError)
    return res.status(400).json({ message: "Review coverage request fields." });
  const status = (e as { status?: number })?.status ?? 409;
  return res
    .status(status)
    .json({
      message:
        status === 403
          ? "You cannot change this coverage request."
          : status === 503
            ? "Coverage resolution storage is not installed in this environment. No changes were saved."
            : "Coverage changed or the replacement is unavailable. Refresh and review; no changes were saved.",
    });
}
const range = z
  .object({ from: z.string(), through: z.string() })
  .refine((v) => validateScheduleRange(v.from, v.through));
router.use(async (_req, res, next) => {
  if (!(await isWorkHubEnabled())) return res.sendStatus(404);
  return next();
});
router.get("/coverage-facts", async (req, res) => {
  try {
    const s = await actor(req, true);
    if (req.query.type !== "vendor" || Number(req.query.id) !== s.vendorId)
      throw Object.assign(Error(), { status: 403 });
    const r = range.parse(req.query);
    const workers = await pool.query(
      `SELECT p.user_id AS "userId", CASE WHEN p.deleted_at IS NOT NULL THEN 'inactive' WHEN p.is_active=false OR u.suspended_at IS NOT NULL THEN 'hold' ELSE 'active' END AS state FROM vendor_people p JOIN users u ON u.id=p.user_id WHERE p.vendor_id=$1`,
      [s.vendorId],
    );
    const unavailable = await pool.query(
      `SELECT user_id AS "userId",starts_at AS "startsAt",ends_at AS "endsAt" FROM work_hub_availability WHERE owner_org_type='vendor' AND owner_org_id=$1 AND available=false AND recurrence IS NULL AND ends_at>$2::date-interval '2 days' AND starts_at<$3::date+interval '3 days'`,
      [s.vendorId, r.from, r.through],
    );
    const requests = await pool.query(
      `SELECT r.id,r.shift_id AS "shiftId",r.requested_by_id AS "userId" FROM work_hub_shift_requests r JOIN work_hub_shifts s ON s.id=r.shift_id WHERE s.owner_org_type='vendor' AND s.owner_org_id=$1 AND r.request_type='coverage' AND r.status='pending'`,
      [s.vendorId],
    );
    const urgent = await pool.query(
      `SELECT c.shift_id FROM workforce_coverage_records c JOIN work_hub_shifts s ON s.id=c.shift_id WHERE s.owner_org_type='vendor' AND s.owner_org_id=$1 AND c.state IN ('escalated','at_risk')`,
      [s.vendorId],
    );
    const ready = (
      await pool.query(
        "SELECT to_regclass('public.workforce_coverage_resolutions') IS NOT NULL AS ready",
      )
    ).rows[0].ready;
    res.json({
      workers: workers.rows,
      unavailable: unavailable.rows,
      requests: requests.rows,
      urgentShiftIds: urgent.rows.map((r) => r.shift_id),
      readOnly: process.env.LOCAL_COVERAGE_READ_ONLY === "1" || !ready,
    });
  } catch (e) {
    failure(res, e);
  }
});
router.get("/my-coverage", async (req, res) => {
  try {
    const s = await actor(req);
    const r = range.parse(req.query);
    const shifts = await pool.query(
      `SELECT s.id,s.version,s.title,s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.timezone,l.name AS "siteName",EXISTS(SELECT 1 FROM work_hub_shift_requests r WHERE r.shift_id=s.id AND r.requested_by_id=$1 AND r.request_type='coverage' AND r.status='pending') AS requested FROM work_hub_shifts s JOIN work_hub_shift_assignments a ON a.shift_id=s.id JOIN site_locations l ON l.id=s.site_location_id WHERE a.user_id=$1 AND a.status NOT IN ('cancelled','declined') AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND s.gate_station_id IS NOT NULL AND s.milestone_status NOT IN ('cancelled','completed') AND s.starts_at>now() AND (s.starts_at AT TIME ZONE s.timezone)::date BETWEEN $3::date AND $4::date ORDER BY s.starts_at`,
      [s.userId, s.vendorId, r.from, r.through],
    );
    res.json({
      shifts: shifts.rows,
      readOnly: process.env.LOCAL_COVERAGE_READ_ONLY === "1",
    });
  } catch (e) {
    failure(res, e);
  }
});
router.post("/request-coverage", async (req, res) => {
  try {
    const s = await actor(req);
    const envelope = workHubCommandEnvelopeSchema.parse(req.body);
    if (envelope.owner.type !== "vendor" || envelope.owner.id !== s.vendorId)
      throw Object.assign(Error(), { status: 403 });
    const p = z
      .object({
        shiftId: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
      })
      .parse(envelope.payload);
    const result = await executeWorkHubCommand(
      { userId: s.userId!, source: "web" },
      `coverage.request:${p.shiftId}`,
      envelope,
      async (tx) => {
        const c = gateAssignmentTransactionClient(tx);
        await lockShiftSchedulingRows(c, s.userId!, p.shiftId, [s.userId!]);
        const found = await c.query(
          `SELECT s.id FROM work_hub_shifts s JOIN work_hub_shift_assignments a ON a.shift_id=s.id WHERE s.id=$1 AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND s.version=$3 AND s.starts_at>now() AND s.milestone_status NOT IN ('cancelled','completed') AND a.user_id=$4 AND a.status NOT IN ('cancelled','declined')`,
          [p.shiftId, s.vendorId, p.expectedVersion, s.userId],
        );
        if (!found.rows.length) throw Object.assign(Error(), { status: 403 });
        const previous = await c.query(
          "SELECT id FROM work_hub_shift_requests WHERE shift_id=$1 AND requested_by_id=$2 AND request_type='coverage' AND status='pending'",
          [p.shiftId, s.userId],
        );
        if (previous.rows.length) return { id: previous.rows[0].id };
        const [request] = await tx
          .insert(workHubShiftRequestsTable)
          .values({
            shiftId: p.shiftId,
            requestType: "coverage",
            requestedById: s.userId!,
            status: "pending",
          })
          .returning({ id: workHubShiftRequestsTable.id });
        await appendWorkHubAudit(
          {
            actorUserId: s.userId!,
            owner: envelope.owner,
            action: "coverage.request",
            subjectType: "shift",
            subjectId: p.shiftId,
            source: "web",
            operationId: envelope.operationId,
            metadata: { requestId: request.id },
          },
          tx,
        );
        return request;
      },
    );
    res.json(result);
  } catch (e) {
    failure(res, e);
  }
});
router.post("/coverage-resolution", async (req, res) => {
  try {
    const s = await actor(req, true),
      envelope = workHubCommandEnvelopeSchema.parse(req.body);
    if (envelope.owner.type !== "vendor" || envelope.owner.id !== s.vendorId)
      throw Object.assign(Error(), { status: 403 });
    const p = z
      .object({
        shiftId: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        originalUserId: z.number().int().positive().nullable(),
        replacementUserId: z.number().int().positive(),
        kind: z.enum(["temporary", "permanent"]),
        requestId: z.string().uuid().nullable(),
      })
      .refine((v) => v.originalUserId !== v.replacementUserId)
      .parse(envelope.payload);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(p))
      .digest("hex");
    if (
      !(
        await pool.query(
          "SELECT to_regclass('public.workforce_coverage_resolutions') IS NOT NULL AS ready",
        )
      ).rows[0].ready
    )
      throw Object.assign(Error(), { status: 503 });
    const result = await executeWorkHubCommand(
      { userId: s.userId!, source: "web" },
      `coverage.resolve:${p.shiftId}`,
      envelope,
      async (tx) => {
        const c = gateAssignmentTransactionClient(tx);
        await lockShiftSchedulingRows(c, s.userId!, p.shiftId, [
          p.replacementUserId,
          ...(p.originalUserId ? [p.originalUserId] : []),
        ]);
        const anchor = (
          await c.query(
            `SELECT s.*,to_char(starts_at AT TIME ZONE timezone,'YYYY-MM-DD') AS day,extract(dow FROM starts_at AT TIME ZONE timezone)::int AS weekday,to_char(starts_at AT TIME ZONE timezone,'HH24:MI') AS starts,to_char(ends_at AT TIME ZONE timezone,'HH24:MI') AS ends FROM work_hub_shifts s WHERE id=$1 AND owner_org_type='vendor' AND owner_org_id=$2 AND version=$3 AND starts_at>now() AND milestone_status NOT IN ('cancelled','completed') FOR UPDATE`,
            [p.shiftId, s.vendorId, p.expectedVersion],
          )
        ).rows[0];
        if (!anchor || !anchor.gate_station_id || anchor.recurrence)
          throw Error("stale");
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `coverage-series:${s.vendorId}:${anchor.gate_station_id}`,
        ]);
        const targets =
          p.kind === "temporary"
            ? [anchor]
            : (
                await c.query(
                  `SELECT * FROM work_hub_shifts WHERE owner_org_type='vendor' AND owner_org_id=$1 AND gate_station_id=$2 AND starts_at>=$3 AND timezone=$4 AND extract(dow FROM starts_at AT TIME ZONE timezone)=$5 AND to_char(starts_at AT TIME ZONE timezone,'HH24:MI')=$6 AND to_char(ends_at AT TIME ZONE timezone,'HH24:MI')=$7 AND recurrence IS NULL AND milestone_status NOT IN ('cancelled','completed') ORDER BY id FOR UPDATE`,
                  [
                    s.vendorId,
                    anchor.gate_station_id,
                    anchor.starts_at,
                    anchor.timezone,
                    anchor.weekday,
                    anchor.starts,
                    anchor.ends,
                  ],
                )
              ).rows;
        if (targets.length > 200) throw Error("too_many");
        for (const t of targets) {
          const active = (
            await c.query(
              "SELECT user_id FROM work_hub_shift_assignments WHERE shift_id=$1 AND status NOT IN ('cancelled','declined') FOR UPDATE",
              [t.id],
            )
          ).rows.map((a) => a.user_id);
          if (active.includes(p.replacementUserId)) {
            if (t.id === anchor.id) throw Error("already_assigned");
            continue;
          }
          if (p.originalUserId && !active.includes(p.originalUserId)) {
            if (t.id === anchor.id) throw Error("changed");
            continue;
          }
          if (
            !p.originalUserId &&
            active.length >= (t.required_staff_count ?? 1)
          ) {
            if (t.id === anchor.id) throw Error("full");
            continue;
          }
          await guardGateShiftAssignments(c, s, t.id, [p.replacementUserId]);
          const overlap = await c.query(
            "SELECT 1 FROM work_hub_shift_assignments a JOIN work_hub_shifts sh ON sh.id=a.shift_id WHERE a.user_id=$1 AND a.status NOT IN ('cancelled','declined') AND sh.milestone_status<>'cancelled' AND sh.starts_at<$3 AND sh.ends_at>$2 LIMIT 1",
            [p.replacementUserId, t.starts_at, t.ends_at],
          );
          if (overlap.rows.length) throw Error("overlap");
          if (p.originalUserId)
            await c.query(
              "UPDATE work_hub_shift_assignments SET status='cancelled' WHERE shift_id=$1 AND user_id=$2",
              [t.id, p.originalUserId],
            );
          await c.query(
            "INSERT INTO work_hub_shift_assignments(shift_id,user_id,assigned_by_id,status) VALUES($1,$2,$3,'assigned') ON CONFLICT(shift_id,user_id) DO UPDATE SET status='assigned',assigned_by_id=EXCLUDED.assigned_by_id",
            [t.id, p.replacementUserId, s.userId],
          );
          await c.query(
            "UPDATE work_hub_shifts SET version=version+1,updated_at=now() WHERE id=$1",
            [t.id],
          );
        }
        const [record] = await tx
          .insert(workforceCoverageResolutionsTable)
          .values({
            vendorId: s.vendorId!,
            siteId: anchor.site_location_id,
            gateStationId: anchor.gate_station_id,
            anchorShiftId: anchor.id,
            originalUserId: p.originalUserId,
            replacementUserId: p.replacementUserId,
            kind: p.kind,
            effectiveDate: anchor.day,
            weekday: anchor.weekday,
            startsAtLocal: anchor.starts,
            endsAtLocal: anchor.ends,
            timezone: anchor.timezone,
            requestId: p.requestId,
            createdById: s.userId!,
            operationId: envelope.operationId,
          })
          .returning();
        if (p.requestId) {
          const done = await c.query(
            "UPDATE work_hub_shift_requests SET status='approved',decided_by_id=$1,decided_at=now() WHERE id=$2 AND shift_id=$3 AND requested_by_id=$4 AND request_type='coverage' AND status='pending' RETURNING id",
            [s.userId, p.requestId, p.shiftId, p.originalUserId],
          );
          if (!done.rows.length) throw Error("request_changed");
        }
        await appendWorkHubAudit(
          {
            actorUserId: s.userId!,
            owner: envelope.owner,
            action: "coverage.resolve",
            subjectType: "shift",
            subjectId: anchor.id,
            source: "web",
            operationId: envelope.operationId,
            metadata: { kind: p.kind, resolutionId: record.id },
          },
          tx,
        );
        return { id: record.id, fingerprint };
      },
    );
    if (result.resource.fingerprint !== fingerprint)
      throw Error("operation_changed");
    res.json(result);
  } catch (e) {
    failure(res, e);
  }
});
export default router;
