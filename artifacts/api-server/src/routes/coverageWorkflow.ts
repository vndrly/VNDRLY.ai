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
  lockShiftSchedulingRows,
} from "../services/gate-shift-assignment";
import { validateScheduleRange } from "../work-hub/site-schedule-policy";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { pendingCoverageFrom, queueCoverageAcknowledgment } from "../work-hub/coverage-acknowledgment";
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
      `SELECT r.id,r.shift_id AS "shiftId",r.requested_by_id AS "userId",r.status FROM work_hub_shift_requests r JOIN work_hub_shifts s ON s.id=r.shift_id WHERE s.owner_org_type='vendor' AND s.owner_org_id=$1 AND r.request_type='coverage' AND r.status IN ('pending','approved')`,
      [s.vendorId],
    );
    const urgent = await pool.query(
      `SELECT a.shift_id AS "shiftId",a.worker_user_id AS "userId",'No-show' AS reason
       FROM workforce_assignment_states a JOIN work_hub_shifts s ON s.id=a.shift_id
       WHERE s.owner_org_type='vendor' AND s.owner_org_id=$1 AND s.ends_at>now()
         AND a.no_show_at IS NOT NULL AND a.state NOT IN ('cancelled','declined','completed')
       UNION
       SELECT e.work_hub_shift_id,e.user_id,'No-show'
       FROM gate_attendance_exceptions e JOIN work_hub_shifts s ON s.id=e.work_hub_shift_id
       WHERE s.owner_org_type='vendor' AND s.owner_org_id=$1 AND s.ends_at>now() AND e.disposition='no_show'
       UNION
       SELECT d.work_hub_shift_id,d.user_id,'Abandoned shift'
       FROM gate_duty_sessions d JOIN work_hub_shifts s ON s.id=d.work_hub_shift_id
       WHERE s.owner_org_type='vendor' AND s.owner_org_id=$1 AND s.ends_at>now()
         AND d.ended_at IS NOT NULL AND d.ended_at<s.ends_at
         AND NOT EXISTS (SELECT 1 FROM gate_duty_sessions replacement
           WHERE replacement.station_id=d.station_id AND replacement.id<>d.id
             AND (replacement.ended_at IS NULL OR replacement.started_at>=d.ended_at))
       UNION
       SELECT c.shift_id,NULL,'Abandoned shift'
       FROM workforce_coverage_records c JOIN work_hub_shifts s ON s.id=c.shift_id
       WHERE s.owner_org_type='vendor' AND s.owner_org_id=$1 AND s.ends_at>now()
         AND c.resolved_at IS NULL AND c.vacancy_origin IN ('abandoned','abandoned_shift')
         AND c.state NOT IN ('covered','resolved','cancelled')`,
      [s.vendorId],
    );
    const ready = (
      await pool.query(
        "SELECT to_regclass('public.workforce_coverage_resolutions') IS NOT NULL AS ready",
      )
    ).rows[0].ready;
    const awaitingAcknowledgment = await pool.query(`SELECT n.id AS "notificationId",s.id AS "shiftId",n.user_id AS "userId",
      (SELECT concat_ws(' ',p.first_name,p.last_name) FROM vendor_people p WHERE p.user_id=n.user_id AND p.vendor_id=$1 ORDER BY p.id LIMIT 1) AS name
      ${pendingCoverageFrom}`, [s.vendorId]);
    res.json({
      workers: workers.rows,
      awaitingAcknowledgment: awaitingAcknowledgment.rows,
      unavailable: unavailable.rows,
      requests: requests.rows,
      urgentShiftIds: urgent.rows.map((r) => r.shiftId),
      incidents: urgent.rows.map(r => ({...r,userId:r.userId ?? undefined})),
      readOnly: process.env.LOCAL_COVERAGE_READ_ONLY === "1" || !ready,
    });
  } catch (e) {
    failure(res, e);
  }
});

router.get("/my-coverage-acknowledgments", async (req, res) => {
  try {
    const s = await actor(req);
    const result = await pool.query(`SELECT n.id,s.title,s.starts_at AS "startsAt",s.timezone
      ${pendingCoverageFrom} AND n.user_id=$2 ORDER BY s.starts_at`, [s.vendorId,s.userId]);
    res.json({notices:result.rows,readOnly:process.env.LOCAL_COVERAGE_READ_ONLY === "1"});
  } catch(e) { failure(res,e); }
});
router.post("/acknowledge-coverage", async (req,res) => {
  try {
    const s = await actor(req);
    if(process.env.LOCAL_COVERAGE_READ_ONLY === "1") throw Object.assign(Error(),{status:403});
    const {notificationId} = z.object({notificationId:z.number().int().positive()}).parse(req.body);
    // Lock the same shift used by reassignment, then recheck ownership. Retries
    // only acknowledge this notice; they never affect a newer assignment.
    const result = await db.transaction(async tx => {
      const c = gateAssignmentTransactionClient(tx);
      const found = await c.query(`SELECT s.id FROM notifications n JOIN work_hub_shifts s
        ON s.id::text=split_part(n.dedupe_key,':',2) WHERE n.id=$1 AND n.user_id=$2
        AND n.type='coverage_assignment' AND s.owner_org_type='vendor' AND s.owner_org_id=$3
        AND s.milestone_status NOT IN ('cancelled','completed') FOR UPDATE OF s`,
        [notificationId,s.userId,s.vendorId]);
      if(!found.rows.length) throw Object.assign(Error(),{status:403});
      const saved = await c.query(`UPDATE notifications n SET acknowledged_at=COALESCE(n.acknowledged_at,now()),
        acknowledged_by_user_id=$2,is_read=true WHERE n.id=$1 AND n.user_id=$2 AND n.acknowledgement_required=true
        AND EXISTS(SELECT 1 FROM work_hub_shift_assignments a WHERE a.shift_id=$3 AND a.user_id=$2 AND a.status NOT IN ('cancelled','declined')) RETURNING n.id`,
        [notificationId,s.userId,found.rows[0].id]);
      if(!saved.rows.length) throw Error('reassigned');
      return {id:notificationId};
    });
    res.json(result);
  } catch(e) {failure(res,e);}
});

async function coverageGatekeepers(client: Pick<typeof pool, "query">, vendorId: number) {
  return (await client.query(`SELECT DISTINCT p.user_id AS id,concat_ws(' ',p.first_name,p.last_name) AS name,
    COALESCE((SELECT d.native_operations->'pickupShifts'='true'::jsonb FROM work_hub_device_preferences d
      WHERE d.user_id=p.user_id AND d.owner_org_type='vendor' AND d.owner_org_id=$1),false) AS "pickupExtraShifts"
    FROM vendor_people p WHERE p.vendor_id=$1 AND p.deleted_at IS NULL AND p.user_id IS NOT NULL
    AND (EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor'))
      OR (NOT EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id) AND p.vendor_role IN ('gatekeeper','gate_supervisor')))`,[vendorId])).rows as {id:number;name:string;pickupExtraShifts:boolean}[];
}


async function coverageScheduleConflicts(client: Pick<typeof pool,"query">, userIds: number[], shiftId: string, start: unknown, end: unknown) {
 return client.query(`SELECT DISTINCT a.user_id FROM work_hub_shift_assignments a JOIN work_hub_shifts sh ON sh.id=a.shift_id
        WHERE a.user_id=ANY($1::int[]) AND sh.id<>$2 AND a.status NOT IN ('cancelled','declined') AND sh.milestone_status<>'cancelled'
        AND sh.ends_at>=$3::timestamptz AND sh.starts_at<=$4::timestamptz
        UNION SELECT operator_id FROM gate_shifts WHERE operator_id=ANY($1::int[])
        AND (ended_at IS NULL OR ended_at>=$3::timestamptz) AND started_at<=$4::timestamptz
        UNION SELECT (run->>'driverUserId')::int FROM vendors v CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.fleet_ops_state->'runs','[]'::jsonb)) run
        WHERE (run->>'driverUserId')::int=ANY($1::int[]) AND run->>'status' IN ('dispatched','acknowledged','in_progress')
        AND (run->'schedule'->>'plannedStartAt')::timestamptz<$4 AND (run->'schedule'->>'plannedEndAt')::timestamptz>$3`,[userIds,shiftId,start,end]);
}

// Read-only eligibility preview. Saving still revalidates the current schedule.
router.get("/coverage-candidates", async (req, res) => {
  try {
    const s = await actor(req, true);
    if (req.query.type !== "vendor" || Number(req.query.id) !== s.vendorId)
      throw Object.assign(Error(), { status: 403 });
    const p = z.object({ shiftId: z.string().uuid(), kind: z.enum(["temporary", "permanent"]),
      originalUserId: z.coerce.number().int().positive().optional() }).parse(req.query);
    const anchor = (await pool.query(`SELECT *,extract(dow FROM starts_at AT TIME ZONE timezone)::int AS weekday,
      to_char(starts_at AT TIME ZONE timezone,'HH24:MI') AS starts,to_char(ends_at AT TIME ZONE timezone,'HH24:MI') AS ends
      FROM work_hub_shifts WHERE id=$1 AND owner_org_type='vendor' AND owner_org_id=$2
      AND starts_at>now() AND recurrence IS NULL AND milestone_status NOT IN ('cancelled','completed')`, [p.shiftId,s.vendorId])).rows[0];
    if (!anchor?.gate_station_id) throw Error("unavailable");
    const targets = p.kind === "temporary" ? [anchor] : (await pool.query(`SELECT * FROM work_hub_shifts
      WHERE owner_org_type='vendor' AND owner_org_id=$1 AND gate_station_id=$2 AND starts_at>=$3 AND timezone=$4
      AND extract(dow FROM starts_at AT TIME ZONE timezone)=$5 AND to_char(starts_at AT TIME ZONE timezone,'HH24:MI')=$6
      AND to_char(ends_at AT TIME ZONE timezone,'HH24:MI')=$7 AND recurrence IS NULL
      AND milestone_status NOT IN ('cancelled','completed') ORDER BY starts_at LIMIT 201`,
      [s.vendorId,anchor.gate_station_id,anchor.starts_at,anchor.timezone,anchor.weekday,anchor.starts,anchor.ends])).rows;
    if (!targets.length || targets.length > 200) throw Error("too_many");
    let candidates = await coverageGatekeepers(pool,s.vendorId!);
    const truncated = false;
    for (const target of targets) {
      const active = (await pool.query("SELECT user_id FROM work_hub_shift_assignments WHERE shift_id=$1 AND status NOT IN ('cancelled','declined')", [target.id])).rows.map(a=>Number(a.user_id));
      if (p.originalUserId ? !active.includes(p.originalUserId) : active.length >= (target.required_staff_count ?? 1)) {
        if (target.id === anchor.id) throw Error("changed");
        continue;
      }
      const eligible = candidates.filter(c=>c.id !== p.originalUserId && !(target.id === anchor.id && active.includes(c.id)));
      const blocked = await coverageScheduleConflicts(pool,eligible.filter(c=>!active.includes(c.id)).map(c=>c.id),target.id,target.starts_at,target.ends_at);
      const blockedIds = new Set(blocked.rows.map(r=>Number(r.user_id)));
      candidates = eligible.filter(c=>!blockedIds.has(c.id));
      if (!candidates.length) break;
    }
    res.json({people:(candidates ?? []).sort((a,b)=>Number(b.pickupExtraShifts)-Number(a.pickupExtraShifts)||a.name.localeCompare(b.name)),truncated});
  } catch (e) { const err=e as {code?:string;column?:string;routine?:string;message?:string}; console.error("Coverage candidates failed", {code:err.code,column:err.column,routine:err.routine,reason:err.message?.startsWith("gate_") ? err.message : undefined}); failure(res,e); }
});
router.get("/my-coverage", async (req, res) => {
  try {
    const s = await actor(req);
    const r = range.parse(req.query);
    const shifts = await pool.query(
      `SELECT s.id,s.version,s.title,s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.timezone,l.name AS "siteName",EXISTS(SELECT 1 FROM work_hub_shift_requests r WHERE r.shift_id=s.id AND r.requested_by_id=$1 AND r.request_type='coverage' AND r.status IN ('pending','approved')) AS requested FROM work_hub_shifts s JOIN work_hub_shift_assignments a ON a.shift_id=s.id JOIN site_locations l ON l.id=s.site_location_id WHERE a.user_id=$1 AND a.status NOT IN ('cancelled','declined') AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND s.gate_station_id IS NOT NULL AND s.milestone_status NOT IN ('cancelled','completed') AND (s.starts_at AT TIME ZONE s.timezone)::date BETWEEN $3::date AND $4::date ORDER BY s.starts_at`,
      [s.userId, s.vendorId, r.from, r.through],
    );
    const statuses=await pool.query("SELECT DISTINCT ON (shift_id) shift_id,status FROM work_hub_shift_requests WHERE requested_by_id=$1 AND shift_id=ANY($2::uuid[]) AND request_type='coverage' ORDER BY shift_id,created_at DESC,id DESC",[s.userId,shifts.rows.map(r=>r.id)]);
    for(const row of shifts.rows) row.requestStatus=statuses.rows.find(r=>r.shift_id===row.id)?.status ?? null;
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
          "SELECT id FROM work_hub_shift_requests WHERE shift_id=$1 AND requested_by_id=$2 AND request_type='coverage' AND status IN ('pending','approved')",
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
router.post('/decide-shift-off',async(req,res)=>{
  try {
    const s=await actor(req,true),envelope=workHubCommandEnvelopeSchema.parse(req.body);
    if(envelope.owner.type!=='vendor'||envelope.owner.id!==s.vendorId||process.env.LOCAL_COVERAGE_READ_ONLY==='1') throw Object.assign(Error(),{status:403});
    const p=z.object({requestId:z.string().uuid(),shiftId:z.string().uuid(),decision:z.enum(['approved','declined'])}).parse(envelope.payload);
    const result=await executeWorkHubCommand({userId:s.userId!,source:'web'},`coverage.decide:${p.requestId}`,envelope,async tx=>{
      const c=gateAssignmentTransactionClient(tx);
      await lockShiftSchedulingRows(c,s.userId!,p.shiftId,[]);
      const row=await c.query(`UPDATE work_hub_shift_requests r SET status=$1,decided_by_id=$2,decided_at=now()
        FROM work_hub_shifts sh WHERE r.id=$3 AND r.shift_id=$4 AND sh.id=r.shift_id
        AND sh.owner_org_type='vendor' AND sh.owner_org_id=$5 AND sh.milestone_status NOT IN ('cancelled','completed')
        AND sh.starts_at>now() AND r.request_type='coverage' AND r.status='pending'
        AND EXISTS(SELECT 1 FROM work_hub_shift_assignments a WHERE a.shift_id=sh.id AND a.user_id=r.requested_by_id AND a.status NOT IN ('cancelled','declined')) RETURNING r.id`,
        [p.decision,s.userId,p.requestId,p.shiftId,s.vendorId]);
      if(!row.rows.length)throw Error('request_changed');
      await appendWorkHubAudit({actorUserId:s.userId!,owner:envelope.owner,action:'coverage.decide',subjectType:'shift',subjectId:p.shiftId,source:'web',operationId:envelope.operationId,metadata:{requestId:p.requestId,decision:p.decision}},tx);
      return {id:p.requestId,decision:p.decision};
    });
    if(result.resource.decision!==p.decision)throw Error('operation_changed');
    res.json(result);
  }catch(e){failure(res,e);}
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
        const offRequests=await c.query(`SELECT id,status FROM work_hub_shift_requests WHERE shift_id=$1 AND requested_by_id=$2 AND request_type='coverage' AND status IN ('pending','approved') FOR UPDATE`,[p.shiftId,p.originalUserId]);
        if(p.requestId && !offRequests.rows.some(r=>r.id===p.requestId&&r.status==='approved'))throw Error('approval_required');
        if(offRequests.rows.some(r=>r.status!=='approved'||r.id!==p.requestId))throw Error('approval_required');
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
          if (!(await coverageGatekeepers(c,s.vendorId!)).some(person=>person.id===p.replacementUserId)) throw Error("gatekeeper_unavailable");
          const overlap = await coverageScheduleConflicts(c,[p.replacementUserId],t.id,t.starts_at,t.ends_at);
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
          await queueCoverageAcknowledgment(c, {shiftId:t.id,userId:p.replacementUserId,
            originalUserId:p.originalUserId,operationId:envelope.operationId,title:t.title,
            startsAt:t.starts_at,timezone:t.timezone});
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
            "UPDATE work_hub_shift_requests SET status='resolved' WHERE id=$1 AND shift_id=$2 AND requested_by_id=$3 AND request_type='coverage' AND status='approved' RETURNING id",
            [p.requestId, p.shiftId, p.originalUserId],
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
