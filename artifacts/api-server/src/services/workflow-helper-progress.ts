import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { z } from "zod/v4";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { AssistantOAuthError } from "../assistant/chatgpt-oauth";
import { isDemoUserId } from "../lib/demo-boundary";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, requireChangeOverAccess } from "./gate-change-over";
import type { GateMovement } from "./gate-topology";

export const GATE_HELPER_KEYS = ["first-watch", "gate-staffing-recovery", "gate-watch-handoff", "gate-vehicle-check-in", "gate-inner-arrival", "gate-vehicle-check-out", "gate-early-turnaround", "gate-return-to-inner", "gate-map-and-log", "gate-shift-scheduling"] as const;
export type GateHelperKey = typeof GATE_HELPER_KEYS[number];
export type HelperProgress = { independentThreshold: 3; independentCompletions: Record<GateHelperKey, number> };
const commandKind = "workflow.helper.completed";
type Queryable = Pick<PoolClient, "query">;

export class WorkflowHelperError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const reject = (status: number, code: string, message: string): never => { throw new WorkflowHelperError(status, `workflow_helper.${code}`, message); };
const savedCompletionRequired = (): never => reject(409, "saved_completion_required", "Complete and save this Gate workflow before recording helper progress.");
const completionSchema = z.object({
  workflowKey: z.enum(GATE_HELPER_KEYS),
  mode: z.enum(["guided", "independent"]),
  recordType: z.enum(["gate-watch", "gate-visit", "gate-scheduled-shift"]),
  recordId: z.union([z.string().trim().min(1).max(100), z.number().int().positive()]).transform(String),
  siteId: z.number().int().positive(),
}).strict();
type Completion = z.infer<typeof completionSchema>;

function parseCompletion(raw: unknown): Completion {
  const parsed = completionSchema.safeParse(raw);
  if (!parsed.success) return reject(400, "invalid_completion", "Choose a supported Gate workflow and its saved record.");
  const input = parsed.data;
  const expected = input.workflowKey === "gate-shift-scheduling" ? "gate-scheduled-shift"
    : ["first-watch", "gate-staffing-recovery", "gate-watch-handoff"].includes(input.workflowKey) ? "gate-watch" : "gate-visit";
  if (input.workflowKey === "gate-map-and-log" || input.recordType !== expected) return reject(400, "invalid_completion", "This Gate helper has no supported saved completion record.");
  if (input.recordType === "gate-visit") {
    if (!/^[1-9]\d*$/.test(input.recordId) || !Number.isSafeInteger(Number(input.recordId))) return reject(400, "invalid_completion", "A saved Gate visit is required.");
    input.recordId = String(Number(input.recordId));
  } else {
    if (!z.uuid().safeParse(input.recordId).success) return reject(400, "invalid_completion", "A saved Gate watch or scheduled shift is required.");
    input.recordId = input.recordId.toLowerCase();
  }
  return input;
}

export function emptyWorkflowHelperProgress(): HelperProgress {
  return { independentThreshold: 3, independentCompletions: Object.fromEntries(GATE_HELPER_KEYS.map(key => [key, 0])) as Record<GateHelperKey, number> };
}

/** Internal projection: the caller has already checked the current company membership. */
export async function readWorkflowHelperProgress(session: Pick<SessionPayload, "userId" | "vendorId">, client: Queryable = pool): Promise<HelperProgress> {
  if (!session.userId || !session.vendorId) return reject(403, "forbidden", "Choose your current vendor company.");
  const progress = emptyWorkflowHelperProgress();
  const rows = (await client.query(`SELECT result_json->>'workflowKey' AS workflow_key,count(*)::int AS completions
    FROM work_hub_client_operations WHERE user_id=$1 AND owner_org_type='vendor' AND owner_org_id=$2
      AND command_kind=$3 AND applied_at IS NOT NULL AND result_json->>'mode'='independent'
      AND result_json->>'workflowKey'=ANY($4::text[]) GROUP BY result_json->>'workflowKey'`, [session.userId, session.vendorId, commandKind, GATE_HELPER_KEYS])).rows;
  for (const row of rows) progress.independentCompletions[row.workflow_key as GateHelperKey] = Number(row.completions);
  return progress;
}

/** The record identity excludes mode: a guided save cannot be replayed as independent. */
function operationId(userId: number, vendorId: number, input: Completion): string {
  const bytes = createHash("sha256").update(JSON.stringify([userId, "vendor", vendorId, input.workflowKey, input.recordType, input.recordId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function visitCompletion(key: GateHelperKey, visit: { gate_movements: GateMovement[]; check_out_time: unknown; gate_station_id: string | null; check_out_gps_evidence: { gateStationId?: string } | null }): string | null {
  const movements = Array.isArray(visit.gate_movements) ? visit.gate_movements : [];
  if (key === "gate-vehicle-check-in") return visit.gate_station_id;
  if (key === "gate-inner-arrival") return movements.find(movement => movement.kind === "enter" && movement.area?.trim())?.gateId ?? null;
  if (key === "gate-vehicle-check-out") return visit.check_out_time ? [...movements].reverse().find(movement => movement.kind === "site_exit")?.gateId ?? visit.check_out_gps_evidence?.gateStationId ?? visit.gate_station_id : null;
  if (key === "gate-early-turnaround") {
    const exit = movements.findIndex(movement => movement.kind === "site_exit" && movement.note === "Exited before inner arrival");
    return visit.check_out_time && exit > 0 && movements.slice(0, exit).some(movement => movement.destinationGateId != null)
      && !movements.slice(0, exit).some(movement => movement.kind === "enter" && movement.area?.trim()) ? movements[exit]!.gateId : null;
  }
  if (key === "gate-return-to-inner") {
    const entered = new Set<string>();
    const departed = new Set<string>();
    for (const movement of movements) {
      if (movement.kind === "enter" && movement.area?.trim()) {
        if (departed.has(movement.gateId)) return movement.gateId;
        entered.add(movement.gateId);
      }
      if (movement.kind === "leave" && entered.has(movement.gateId)) departed.add(movement.gateId);
    }
  }
  return null;
}

async function verifySavedCompletion(client: Queryable, session: SessionPayload, input: Completion): Promise<void> {
  const access = await requireChangeOverAccess(client, session, input.siteId);
  let stationId: string | null = null;
  if (input.recordType === "gate-watch") {
    const watch = (await client.query(`SELECT w.station_id,w.operator_id FROM gate_shifts w
      JOIN gate_stations g ON g.id=w.station_id AND g.site_id=$3
      JOIN gate_duty_sessions d ON d.source_legacy_shift_id=w.id AND d.station_id=w.station_id AND d.user_id=w.operator_id
      JOIN tickets t ON t.id::text=d.post_coverage->>'ticketId' AND t.vendor_id=$2 AND t.site_location_id=g.site_id AND t.status<>'cancelled'
      WHERE w.id=$1 AND d.post_coverage->>'vendorId'=$2::text
      AND ($4::boolean OR w.operator_id=$5)
      AND ($6::boolean=false OR EXISTS(SELECT 1 FROM gate_handovers h WHERE h.incoming_shift_id=w.id AND h.incoming_user_id=w.operator_id))
      LIMIT 1 FOR SHARE OF w,d,t`, [input.recordId, session.vendorId, input.siteId, access.supervisor, session.userId, input.workflowKey === "gate-watch-handoff"])).rows[0];
    if (!watch) return savedCompletionRequired();
    stationId = watch.station_id;
  } else if (input.recordType === "gate-scheduled-shift") {
    if (!access.supervisor) return reject(403, "forbidden", "Current Gate scheduling authority is required.");
    const shift = (await client.query(`SELECT s.gate_station_id FROM work_hub_shifts s
      JOIN gate_stations g ON g.id=s.gate_station_id AND g.site_id=s.site_location_id AND g.active=true
      WHERE s.id=$1 AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND s.site_location_id=$3
        AND s.milestone_status<>'cancelled' AND s.ends_at>s.starts_at
        AND EXISTS(SELECT 1 FROM work_hub_shift_assignments a JOIN users u ON u.id=a.user_id AND u.suspended_at IS NULL
          JOIN user_org_memberships m ON m.user_id=a.user_id AND m.org_type='vendor' AND m.vendor_id=$2
          WHERE a.shift_id=s.id AND a.status IN ('assigned','accepted','claimed'))
      FOR SHARE OF s`, [input.recordId, session.vendorId, input.siteId])).rows[0];
    if (!shift) return savedCompletionRequired();
    stationId = shift.gate_station_id;
  } else {
    const visit = (await client.query(`SELECT gate_station_id,gate_movements,check_out_time,check_out_gps_evidence FROM site_visits
      WHERE id=$1 AND site_location_id=$2 AND admission_status IS DISTINCT FROM 'pending' AND admission_status IS DISTINCT FROM 'denied'
        AND reconciliation_state IS DISTINCT FROM 'confirmed_off_site' FOR SHARE`, [input.recordId, input.siteId])).rows[0];
    if (!visit) return savedCompletionRequired();
    stationId = visitCompletion(input.workflowKey, visit);
    if (!stationId) return savedCompletionRequired();
  }
  // Temporary office coverage is confined to its saved watch's station.
  await requireChangeOverAccess(client, session, input.siteId, { stationId: stationId! });
}

/** Personal coaching telemetry only. This never changes business records or access. */
export async function recordWorkflowHelperCompletion(session: SessionPayload, raw: unknown) {
  if (session.publicDemo || session.realm === "demo" || isDemoUserId(session.userId) || !session.userId || !session.vendorId || !session.activeMembershipId) return reject(403, "forbidden", "Current company membership is required.");
  const input = parseCompletion(raw);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    // Current-account changes and concurrent receipts share this actor lock.
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [session.userId]);
    let fresh: SessionPayload;
    try { fresh = await validateAssistantSession(session, drizzle(client, { schema })); }
    catch (error) { if (error instanceof AssistantOAuthError) return reject(403, "forbidden", "Your current company context changed. Refresh before continuing."); throw error; }
    if (!fresh.vendorId || !["vendor", "field_employee"].includes(fresh.role ?? "")) return reject(403, "forbidden", "Current vendor company membership is required.");
    await client.query("SELECT id FROM user_org_memberships WHERE id=$1 AND user_id=$2 AND vendor_id=$3 FOR SHARE", [fresh.activeMembershipId, fresh.userId, fresh.vendorId]);
    await verifySavedCompletion(client, fresh, input);
    const id = operationId(fresh.userId!, fresh.vendorId, input);
    await client.query(`INSERT INTO work_hub_client_operations(user_id,command_kind,operation_id,owner_org_type,owner_org_id,result_json,applied_at)
      VALUES($1,$2,$3,'vendor',$4,$5::jsonb,now()) ON CONFLICT(user_id,command_kind,operation_id) DO NOTHING`, [fresh.userId, commandKind, id, fresh.vendorId, JSON.stringify(input)]);
    const saved = (await client.query("SELECT result_json FROM work_hub_client_operations WHERE user_id=$1 AND command_kind=$2 AND operation_id=$3 AND owner_org_type='vendor' AND owner_org_id=$4", [fresh.userId, commandKind, id, fresh.vendorId])).rows[0]?.result_json as Completion | undefined;
    if (!saved) throw new Error("Workflow helper receipt was not saved");
    const helperProgress = await readWorkflowHelperProgress(fresh, client);
    await client.query("COMMIT");
    return { recorded: true as const, counted: saved.mode === "independent", mode: saved.mode, helperProgress };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof ChangeOverError) throw new WorkflowHelperError(error.status, "workflow_helper.forbidden", "Current access to this Gate site is required.");
    throw error;
  } finally { client.release(); }
}
