import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import type { Pool, PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import { normalizePlateState } from "@workspace/plate-state";
import { observeGateCrossing } from "./gate-reconciliation";
import { legacyOperationalRoles } from "../lib/vendor-person-access";
import { managedWorkerSiteRole } from "../lib/managed-worker-access";
export const OfflineGateObservationSchema = z
  .object({
    siteLocationId: z.number().int().positive(),
    direction: z.enum(["entry", "exit"]),
    source: z.literal("gatekeeper"),
    observedAt: z.iso.datetime(),
    plate: z.string().trim().min(1).max(32).optional(),
    plateState: z.string().trim().min(2).max(8).optional(),
    operationId: z.uuid(),
    reportedVisitor: z
      .object({
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        company: z.string().trim().max(200).optional(),
        purpose: z.string().trim().max(500).optional(),
        notes: z.string().trim().max(2000).optional(),
      })
      .strict()
      .optional(),
    originalVisitId: z.number().int().positive().optional(),
    entryOperationId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.direction === "entry" && !value.reportedVisitor)
      ctx.addIssue({
        code: "custom",
        message: "Visitor details required",
        path: ["reportedVisitor"],
      });
    if (
      value.direction === "exit" &&
      !value.originalVisitId &&
      !value.entryOperationId
    )
      ctx.addIssue({
        code: "custom",
        message: "Exact entry required",
        path: ["originalVisitId"],
      });
    if (value.originalVisitId && value.entryOperationId)
      ctx.addIssue({
        code: "custom",
        message: "Use one exact entry",
        path: ["originalVisitId"],
      });
    if (
      value.direction === "entry" &&
      (value.originalVisitId || value.entryOperationId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Entry cannot target another visit",
      });
  });
export class OfflineGateError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
/** Current site contract and normalized roles are re-read under the save transaction. */
export async function authorizeOfflineGateObservation(
  c: PoolClient,
  session: SessionPayload,
  siteId: number,
) {
  if (!session.userId || !session.vendorId || !session.sv)
    throw new OfflineGateError("gate.current_session_required", 403);
  const user = await c.query(
    "SELECT session_version,suspended_at,must_change_password FROM users WHERE id=$1 FOR SHARE",
    [session.userId],
  );
  if (
    !user.rows[0] ||
    user.rows[0].session_version !== session.sv ||
    user.rows[0].suspended_at ||
    user.rows[0].must_change_password
  )
    throw new OfflineGateError("gate.current_session_required", 403);
  const nativeCompany = await c.query(
    "SELECT native_operations_policy FROM vendors WHERE id=$1 FOR SHARE",
    [session.vendorId],
  );
  if (nativeCompany.rows[0]?.native_operations_policy?.enabled === false)
    throw new OfflineGateError("native.company_opted_out", 403);
  const nativeSiteOwner = await c.query(
    "SELECT native_operations_policy FROM partners WHERE id=(SELECT partner_id FROM site_locations WHERE id=$1) FOR SHARE",
    [siteId],
  );
  if (nativeSiteOwner.rows[0]?.native_operations_policy?.enabled === false)
    throw new OfflineGateError("native.company_opted_out", 403);
  const assignment = await c.query(
    "SELECT a.id FROM site_work_assignments a JOIN site_locations sl ON sl.id=a.site_location_id JOIN partner_vendor_relationships p ON p.partner_id=sl.partner_id AND p.vendor_id=a.vendor_id WHERE a.site_location_id=$1 AND a.vendor_id=$2 AND a.is_gate_contractor=true AND sl.is_active=true AND sl.hidden=false AND p.status='approved' FOR SHARE OF a,sl,p",
    [siteId, session.vendorId],
  );
  if (!assignment.rows.length)
    throw new OfflineGateError("gate.site_no_access", 403);
  const membership = await c.query(
    "SELECT role FROM user_org_memberships WHERE user_id=$1 AND vendor_id=$2 FOR SHARE",
    [session.userId, session.vendorId],
  );
  if (membership.rows.some((r) => r.role === "admin")) return;
  if (session.managedSubcontractor) {
    if (
      !session.exp ||
      session.exp <= Date.now() / 1000 ||
      !managedWorkerSiteRole(session, siteId)
    )
      throw new OfflineGateError("gate.site_no_access", 403);
    return;
  }
  if (!membership.rows.length)
    throw new OfflineGateError("gate.membership_required", 403);
  const person = await c.query(
    "SELECT id,vendor_role FROM vendor_people WHERE user_id=$1 AND vendor_id=$2 AND is_active=true AND deleted_at IS NULL FOR SHARE",
    [session.userId, session.vendorId],
  );
  if (!person.rows.length)
    throw new OfflineGateError("gate.person_no_access", 403);
  const roleRows = await c.query(
    "SELECT role FROM vendor_person_operational_roles WHERE vendor_people_id=$1 AND is_active=true FOR SHARE",
    [person.rows[0].id],
  );
  const roles = roleRows.rows.length
    ? roleRows.rows.map((r) => r.role)
    : legacyOperationalRoles(person.rows[0].vendor_role);
  if (!roles.some((r) => r === "gatekeeper" || r === "gate_supervisor"))
    throw new OfflineGateError("gate.role_required", 403);
  const selected = await c.query(
    "SELECT id FROM vendor_person_site_access WHERE vendor_people_id=$1 AND site_location_id=$2 AND is_active=true FOR SHARE",
    [person.rows[0].id, siteId],
  );
  if (!selected.rows.length)
    throw new OfflineGateError("gate.site_no_access", 403);
}
type Authority = (
  c: PoolClient,
  session: SessionPayload,
  siteId: number,
) => Promise<void>;
export function createOfflineGateObservationService(
  database: Pick<Pool, "connect"> = pool,
  authorize: Authority = authorizeOfflineGateObservation,
) {
  return {
    async execute(session: SessionPayload, raw: unknown) {
      const input = OfflineGateObservationSchema.parse(raw);
      if (Date.parse(input.observedAt) > Date.now() + 5 * 60_000)
        throw new OfflineGateError("gate.observation_future", 400);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([session.userId, session.vendorId, input]))
        .digest("hex");
      const c = await database.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `offline-gate-operation:${input.operationId}`,
        ]);
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `offline-gate-site:${input.siteLocationId}`,
        ]);
        await authorize(c, session, input.siteLocationId);
        const prior = await c.query(
          "SELECT user_id,vendor_id,tool_input,tool_output FROM assistant_action_audit WHERE target_type='gate-offline-observation' AND target_id=$1 ORDER BY id LIMIT 1",
          [input.operationId],
        );
        if (prior.rows[0]) {
          const old = prior.rows[0];
          if (
            old.user_id !== session.userId ||
            old.vendor_id !== session.vendorId ||
            old.tool_input.fingerprint !== fingerprint
          )
            throw new OfflineGateError("gate.observation_operation_conflict");
          await c.query("COMMIT");
          return old.tool_output;
        }
        const site = await c.query(
          "SELECT partner_id FROM site_locations WHERE id=$1 FOR SHARE",
          [input.siteLocationId],
        );
        if (!site.rows.length)
          throw new OfflineGateError("gate.site_not_found", 404);
        const databaseClient = drizzle(c, { schema });
        const observation = observeGateCrossing({
          direction: input.direction,
          source: input.source,
          at: new Date(input.observedAt),
          plate: input.plate,
          plateState: input.plateState,
        });
        const facts: Record<
          string,
          { value: string; source: "observed" | "supplied_later" }
        > = {
          ...observation.facts,
          operationId: { value: input.operationId, source: "observed" },
          authorization: { value: "not_verified_offline", source: "observed" },
        };
        if (input.reportedVisitor)
          for (const [key, value] of Object.entries(input.reportedVisitor))
            if (value) facts[key] = { value, source: "supplied_later" };
        let visit: schema.SiteVisit;
        if (input.direction === "exit") {
          let original = input.originalVisitId;
          if (input.entryOperationId) {
            const entry = await c.query(
              "SELECT user_id,vendor_id,tool_input,tool_output FROM assistant_action_audit WHERE target_type='gate-offline-observation' AND target_id=$1 ORDER BY id LIMIT 1",
              [input.entryOperationId],
            );
            const linked = entry.rows[0];
            if (
              !linked ||
              linked.user_id !== session.userId ||
              linked.vendor_id !== session.vendorId ||
              linked.tool_input.input.direction !== "entry" ||
              linked.tool_output.siteLocationId !== input.siteLocationId
            )
              throw new OfflineGateError("gate.entry_not_synced", 409);
            original = linked.tool_output.id;
          }
          const row = await c.query(
            "SELECT id,site_location_id,check_in_time,check_out_time FROM site_visits WHERE id=$1 FOR UPDATE",
            [original],
          );
          if (
            !row.rows.length ||
            row.rows[0].site_location_id !== input.siteLocationId
          )
            throw new OfflineGateError("gate.exact_entry_not_found", 404);
          if (row.rows[0].check_out_time)
            throw new OfflineGateError("gate.entry_already_closed");
          if (
            Date.parse(input.observedAt) < row.rows[0].check_in_time.getTime()
          )
            throw new OfflineGateError("gate.exit_before_entry");
          const [priorVisit] = await databaseClient
            .select()
            .from(schema.siteVisitsTable)
            .where(eq(schema.siteVisitsTable.id, original!));
          const [updated] = await databaseClient
            .update(schema.siteVisitsTable)
            .set({
              checkOutTime: new Date(input.observedAt),
              observedDepartureAt: new Date(input.observedAt),
              observedDirection: "exit",
              observationSource: "gatekeeper",
              autoCheckedOut: false,
              reconciliationState: "needs_supervisor_review",
              reconciliationFacts: {
                ...priorVisit.reconciliationFacts,
                ...facts,
              },
              admissionStatus: "pending",
              checkOutNotes: input.reportedVisitor?.notes ?? null,
            })
            .where(eq(schema.siteVisitsTable.id, original!))
            .returning();
          visit = updated;
        } else {
          const visitor = input.reportedVisitor!;
          const [created] = await databaseClient
            .insert(schema.siteVisitsTable)
            .values({
              siteLocationId: input.siteLocationId,
              firstName: visitor.firstName,
              lastName: visitor.lastName,
              company: visitor.company ?? null,
              purpose: visitor.purpose ?? null,
              notes: visitor.notes ?? null,
              vehiclePlate: input.plate ?? null,
              plateState: normalizePlateState(input.plateState) ?? null,
              hostType: "partner",
              hostPartnerId: site.rows[0].partner_id,
              checkInTime: new Date(input.observedAt),
              observedArrivalAt: new Date(input.observedAt),
              observedDirection: "entry",
              observationSource: "gatekeeper",
              reconciliationState: "needs_supervisor_review",
              reconciliationFacts: facts,
              admissionStatus: "pending",
              recordedByUserId: session.userId,
            })
            .returning();
          visit = created;
        }
        await authorize(c, session, input.siteLocationId);
        await c.query(
          "INSERT INTO assistant_action_audit(user_id,actor_role,partner_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,$4,'ios','device_entry','vndrly','record_offline_gate_observation','mutation','gate-offline-observation',$5,$6::jsonb,$7::jsonb,'success')",
          [
            session.userId,
            session.role,
            session.partnerId ?? null,
            session.vendorId,
            input.operationId,
            JSON.stringify({ fingerprint, input }),
            JSON.stringify(visit),
          ],
        );
        await c.query("COMMIT");
        return visit;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
export const offlineGateObservationService =
  createOfflineGateObservationService();
