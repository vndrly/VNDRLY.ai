import { createHash } from "node:crypto";
import { db, pool } from "@workspace/db";
import { GateShiftAssignmentInputSchema, GateShiftClaimInputSchema, GateShiftAssignmentReceiptSchema, GateShiftStaffingCandidatesSchema, gateShiftAssignmentFingerprintValues } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import type { Pool, PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import { requireChangeOverAccess } from "./gate-change-over";
import { readGateStaffingCandidatesForClient } from "../assistant/gate-staffing-candidates";
import { assertGateShiftAssignmentPolicy } from "./gate-shift-assignment-policy";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { createWorkHubAccess, requireWorkHubCapability } from "../work-hub/context-access";

export class GateShiftAssignmentError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
type Client = Pick<PoolClient, "query"> & { transactionDatabase?: Omit<typeof db, "$client"> };
const kind = "shift.gate.assign";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Parameterized bridge for the existing Drizzle transaction, never a separate connection. */
export function gateAssignmentTransactionClient(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Client {
  return { transactionDatabase: tx, query: async (text: string, values: unknown[] = []) => {
    const parts = text.split(/(\$\d+)/g);
    const query = sql.join(parts.map(part => /^\$\d+$/.test(part)
      ? sql`${values[Number(part.slice(1)) - 1]}` : sql.raw(part)), sql.raw(""));
    const result = await tx.execute(query) as { rows?: unknown[] } | unknown[];
    const rows = Array.isArray(result) ? result : result.rows ?? [];
    return { rows, rowCount: rows.length };
  } } as unknown as Client;
}

/** Scheduling locks users first, then the full target/conflict shift set in UUID order. */
export async function lockShiftSchedulingRows(client: Client, actorUserId: number, shiftId: string|null, selectedIds: number[] = []) {
  await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='15s'");
  const assigned=async()=>shiftId?(await client.query("SELECT user_id FROM work_hub_shift_assignments WHERE shift_id=$1 ORDER BY user_id",[shiftId])).rows.map(row=>Number(row.user_id)).filter(id=>Number.isSafeInteger(id)&&id>0):[];
  const prior=await assigned(),users=[...new Set([actorUserId,...selectedIds,...prior])].sort((a,b)=>a-b);
  if(users.some(id=>!Number.isSafeInteger(id)||id<1))throw new GateShiftAssignmentError("work_hub.forbidden",403);
  // FOR UPDATE conflicts with assignment FK checks, so newly inserted conflicts cannot appear during eligibility reads.
  await client.query("SELECT id FROM users WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE",[users]);
  if((await assigned()).some(id=>!users.includes(id)))throw new GateShiftAssignmentError("work_hub.version_conflict");
  const affected=[...new Set([...selectedIds,...prior])].sort((a,b)=>a-b);
  const locked=await client.query("SELECT s.id FROM work_hub_shifts s WHERE s.id=$2::uuid OR EXISTS(SELECT 1 FROM work_hub_shift_assignments a WHERE a.shift_id=s.id AND a.user_id=ANY($1::integer[])) ORDER BY s.id FOR UPDATE",[affected,shiftId]);
  if((await assigned()).some(id=>!users.includes(id)))throw new GateShiftAssignmentError("work_hub.version_conflict");
  const seen=new Set(locked.rows.map(row=>row.id));
  const conflicts=await client.query("SELECT DISTINCT shift_id FROM work_hub_shift_assignments WHERE user_id=ANY($1::integer[]) ORDER BY shift_id",[affected]);
  if(conflicts.rows.some(row=>row.shift_id&&!seen.has(row.shift_id)))throw new GateShiftAssignmentError("work_hub.version_conflict");
}

async function currentGateShift(client: Client, session: SessionPayload, shiftId: string, supervisor = true) {
  if (!session.userId || !session.vendorId || !session.activeMembershipId || !["vendor", "field_employee"].includes(session.role ?? "")) {
    throw new GateShiftAssignmentError("work_hub.not_found", 404);
  }
  const result = await client.query(`SELECT s.* FROM work_hub_shifts s JOIN gate_stations g ON g.id=s.gate_station_id
    WHERE s.id=$1 AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND s.site_location_id=g.site_id
    AND g.active=true`, [shiftId, session.vendorId]);
  if (result.rows.length !== 1) throw new GateShiftAssignmentError("work_hub.not_found", 404);
  const shift = result.rows[0];
  await authorizeGateSchedulingSite(client, session, Number(shift.site_location_id), shift.gate_station_id, supervisor);
  return shift;
}

export async function authorizeGateSchedulingSite(client: Client, session: SessionPayload, siteId: number, stationId: string, supervisor = true, allowInactive = false) {
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='15s'");
  if (!session.userId || !session.vendorId || !session.activeMembershipId || !["vendor", "field_employee"].includes(session.role ?? "")) throw new GateShiftAssignmentError("work_hub.forbidden", 403);
  await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [session.userId]);
  await client.query("SELECT id FROM user_org_memberships WHERE user_id=$1 ORDER BY id FOR SHARE", [session.userId]);
  await client.query("SELECT id FROM vendor_people WHERE user_id=$1 ORDER BY id FOR UPDATE", [session.userId]);
  for (const table of ["vendor_person_operational_roles", "vendor_person_site_access"]) await client.query(`SELECT id FROM ${table} WHERE vendor_people_id IN (SELECT id FROM vendor_people WHERE user_id=$1) ORDER BY id FOR SHARE`, [session.userId]);
  await client.query("SELECT id FROM managed_subcontractor_worker_sponsorships WHERE worker_user_id=$1 ORDER BY id FOR UPDATE", [session.userId]);
  await client.query("SELECT id FROM managed_subcontractor_role_grants WHERE sponsorship_id IN (SELECT id FROM managed_subcontractor_worker_sponsorships WHERE worker_user_id=$1) ORDER BY id FOR SHARE", [session.userId]);
  await client.query("SELECT id FROM site_locations WHERE id=$1 FOR SHARE", [siteId]);
  await client.query("SELECT id FROM site_work_assignments WHERE vendor_id=$1 AND site_location_id=$2 ORDER BY id FOR SHARE", [session.vendorId, siteId]);
  await client.query("SELECT id FROM partner_vendor_relationships WHERE vendor_id=$1 AND partner_id=(SELECT partner_id FROM site_locations WHERE id=$2) ORDER BY id FOR SHARE", [session.vendorId, siteId]);
  const freshSession = await validateAssistantSession(session, client.transactionDatabase ?? drizzle(client as PoolClient, { schema }));
  const access = await requireChangeOverAccess(client, session, siteId, { allowInactiveSite: allowInactive });
  if (supervisor && !access.supervisor) throw new GateShiftAssignmentError("work_hub.forbidden", 403);
  if (supervisor) requireWorkHubCapability(createWorkHubAccess({ session: { ...freshSession, userId: session.userId },
    owner: { type: "vendor", id: session.vendorId }, context: { kind: "gate", id: siteId }, participant: true }), "shift.manage");
  const station = await client.query("SELECT id FROM gate_stations WHERE id=$1 AND site_id=$2 AND ($3::boolean OR active=true) FOR SHARE", [stationId, siteId, allowInactive]);
  if (!station.rows.length) throw new GateShiftAssignmentError("work_hub.not_found", 404);
  const contract = await client.query(`SELECT a.id FROM site_work_assignments a
    JOIN site_locations s ON s.id=a.site_location_id
    JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id AND r.vendor_id=a.vendor_id
    WHERE a.site_location_id=$1 AND a.vendor_id=$2 AND a.is_gate_contractor=true
    AND r.status='approved' AND ($3::boolean OR s.is_active=true) AND s.hidden=false`, [siteId, session.vendorId, allowInactive]);
  if (!contract.rows.length) throw new GateShiftAssignmentError("gate_candidates.contract_required", 403);
}

/** Locks the exact existing evidence and parent FK rows before checking eligibility or saving. */
export async function guardGateShiftAssignments(
  client: Client, session: SessionPayload, shiftId: string, userIds: number[], supervisor = true,
) {
  if (userIds.length > 20) throw new GateShiftAssignmentError("work_hub.invalid_operation", 400);
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='15s'");
  const users = [...new Set([session.userId!, ...userIds])].sort((a, b) => a - b);
  await lockShiftSchedulingRows(client, session.userId!, shiftId, userIds);
  const shift = await currentGateShift(client, session, shiftId, supervisor);
  if (!supervisor && userIds.some(id => id !== session.userId)) throw new GateShiftAssignmentError("work_hub.forbidden", 403);
  await client.query("SELECT id FROM gate_stations WHERE id=$1 FOR SHARE", [shift.gate_station_id]);
  await client.query("SELECT id FROM site_locations WHERE id=$1 FOR SHARE", [shift.site_location_id]);
  await client.query("SELECT id FROM site_work_assignments WHERE vendor_id=$1 AND site_location_id=$2 FOR SHARE", [session.vendorId, shift.site_location_id]);
  await client.query("SELECT id FROM partner_vendor_relationships WHERE vendor_id=$1 AND partner_id=(SELECT partner_id FROM site_locations WHERE id=$2) FOR SHARE", [session.vendorId, shift.site_location_id]);
  await client.query("SELECT id FROM user_org_memberships WHERE user_id=ANY($1::integer[]) ORDER BY id FOR SHARE", [users]);
  await client.query("SELECT id FROM managed_subcontractor_worker_sponsorships WHERE worker_user_id=$1 ORDER BY id FOR UPDATE", [session.userId]);
  await client.query("SELECT id FROM managed_subcontractor_role_grants WHERE sponsorship_id IN (SELECT id FROM managed_subcontractor_worker_sponsorships WHERE worker_user_id=$1) ORDER BY id FOR SHARE", [session.userId]);
  await client.query("SELECT id FROM vendor_people WHERE user_id=ANY($1::integer[]) ORDER BY id FOR UPDATE", [users]);
  for (const table of ["vendor_person_operational_roles", "vendor_person_site_access"]) {
    await client.query(`SELECT id FROM ${table} WHERE vendor_people_id IN (SELECT id FROM vendor_people WHERE user_id=ANY($1::integer[])) ORDER BY id FOR SHARE`, [users]);
  }
  await client.query("SELECT id FROM employee_certifications WHERE employee_id IN (SELECT id FROM vendor_people WHERE user_id=ANY($1::integer[])) ORDER BY id FOR SHARE", [users]);
  await client.query("SELECT id FROM work_hub_availability WHERE user_id=ANY($1::integer[]) ORDER BY id FOR SHARE", [userIds]);
  await client.query("SELECT s.id FROM work_hub_shifts s WHERE s.id<>$2 AND EXISTS(SELECT 1 FROM work_hub_shift_assignments a WHERE a.shift_id=s.id AND a.user_id=ANY($1::integer[])) ORDER BY s.id FOR SHARE", [userIds, shiftId]);
  await client.query("SELECT id FROM work_hub_shift_assignments WHERE user_id=ANY($1::integer[]) ORDER BY id FOR SHARE", [userIds]);
  await client.query("SELECT o.id FROM work_hub_meeting_occurrences o WHERE EXISTS(SELECT 1 FROM work_hub_meeting_participants p WHERE p.occurrence_id=o.id AND p.user_id=ANY($1::integer[])) ORDER BY o.id FOR SHARE", [userIds]);
  await client.query("SELECT id FROM work_hub_meeting_participants WHERE user_id=ANY($1::integer[]) ORDER BY id FOR SHARE", [userIds]);
  // All mutable evidence is locked before this fresh authority and policy read.
  const fresh = await currentGateShift(client, session, shiftId, supervisor);
  if (userIds.length && (fresh.recurrence != null || ["cancelled", "completed"].includes(fresh.milestone_status))) throw new GateShiftAssignmentError("work_hub.invalid_operation");
  const evidence = await readGateStaffingCandidatesForClient(shiftId, session, client, requireChangeOverAccess, new Date(), userIds, supervisor);
  assertGateShiftAssignmentPolicy(fresh.qualification_codes, userIds, evidence.candidates);
  if (evidence.shiftVersion !== fresh.version) throw new GateShiftAssignmentError("work_hub.version_conflict");
  return { shift: fresh, evidence };
}

export async function readGateShiftCandidates(session: SessionPayload, shiftId: string, database: Pick<Pool, "connect"> = pool) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await lockShiftSchedulingRows(client,session.userId!,shiftId);
    const shift = await currentGateShift(client, session, shiftId);
    const evidence = await readGateStaffingCandidatesForClient(shiftId, session, client);
    const fresh = await currentGateShift(client, session, shiftId);
    if (fresh.version !== evidence.shiftVersion || JSON.stringify(fresh.qualification_codes) !== JSON.stringify(shift.qualification_codes)) throw new GateShiftAssignmentError("work_hub.version_conflict");
    const result = GateShiftStaffingCandidatesSchema.parse({ ...evidence,
      qualificationConfiguration: shift.qualification_codes === null ? "unknown" : shift.qualification_codes.length ? "configured" : "none_configured",
    });
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function executeGateShiftAssignment(session: SessionPayload, shiftId: string, raw: unknown, database: Pick<Pool, "connect"> = pool, claim = false) {
  const input = GateShiftAssignmentInputSchema.parse(raw);
  const assignees = [...new Set(input.assigneeUserIds)].sort((a, b) => a - b);
  const values = gateShiftAssignmentFingerprintValues(shiftId, session.userId!, session.vendorId!, input);
  const fingerprint = hash(claim ? { action: "claim", ...values } : values);
  const commandKind = claim ? "shift.gate.claim" : kind;
  if (claim && (assignees.length !== 1 || assignees[0] !== session.userId)) throw new GateShiftAssignmentError("work_hub.forbidden", 403);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await lockShiftSchedulingRows(client,session.userId!,shiftId,assignees);
    await currentGateShift(client, session, shiftId, !claim);
    const existing = await client.query("SELECT result_json FROM work_hub_client_operations WHERE user_id=$1 AND command_kind=$2 AND operation_id=$3 AND owner_org_type='vendor' AND owner_org_id=$4", [session.userId, commandKind, input.operationId, session.vendorId]);
    if (existing.rows.length) {
      const receipt = GateShiftAssignmentReceiptSchema.parse(existing.rows[0].result_json);
      if (receipt.commandFingerprint !== fingerprint || receipt.shiftId !== shiftId) throw new GateShiftAssignmentError("work_hub.operation_conflict");
      await client.query("COMMIT"); return receipt;
    }
    const { shift } = await guardGateShiftAssignments(client, session, shiftId, assignees, !claim);
    if (shift.version !== input.expectedVersion) throw new GateShiftAssignmentError("work_hub.version_conflict");
    if (claim) {
      const assigned = await client.query("SELECT id FROM work_hub_shift_assignments WHERE shift_id=$1 LIMIT 1", [shiftId]);
      if (!shift.open || assigned.rows.length) throw new GateShiftAssignmentError("work_hub.invalid_operation");
    }
    const updated = await client.query("UPDATE work_hub_shifts SET version=version+1,open=CASE WHEN $3::boolean THEN false ELSE open END,updated_at=now() WHERE id=$1 AND version=$2 RETURNING version", [shiftId, input.expectedVersion, claim]);
    if (updated.rows.length !== 1) throw new GateShiftAssignmentError("work_hub.version_conflict");
    await client.query("DELETE FROM work_hub_shift_assignments WHERE shift_id=$1", [shiftId]);
    for (const userId of assignees) await client.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id,assigned_by_id,status) VALUES($1,$2,$3,$4)", [shiftId, userId, session.userId, claim ? "claimed" : "assigned"]);
    if (claim) await client.query("INSERT INTO work_hub_shift_requests(shift_id,request_type,requested_by_id,status,decided_by_id,decided_at) VALUES($1,'claim',$2,'approved',$2,now())", [shiftId, session.userId]);
    const receipt = GateShiftAssignmentReceiptSchema.parse({ operationId: input.operationId, actorUserId: session.userId, shiftId,
      previousVersion: input.expectedVersion, resultingVersion: updated.rows[0].version, assigneeUserIds: assignees,
      commandFingerprint: fingerprint, recordedAt: new Date().toISOString(), assignmentRecorded: true, physicalAttendanceVerified: false });
    await client.query("INSERT INTO work_hub_client_operations(user_id,command_kind,operation_id,owner_org_type,owner_org_id,result_json,applied_at) VALUES($1,$2,$3,'vendor',$4,$5::jsonb,now())", [session.userId, commandKind, input.operationId, session.vendorId, JSON.stringify(receipt)]);
    await client.query("INSERT INTO work_hub_audit_log(actor_user_id,owner_org_type,owner_org_id,action,subject_type,subject_id,prior_version,new_version,source,operation_id,metadata) VALUES($1,'vendor',$2,$8,'shift',$3,$4,$5,'web',$6,$7::jsonb)", [session.userId, session.vendorId, shiftId, input.expectedVersion, receipt.resultingVersion, input.operationId, JSON.stringify({ assigneeUserIds: assignees, physicalAttendanceVerified: false }), commandKind]);
    await client.query("COMMIT"); return receipt;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function readGateShiftAssignment(session: SessionPayload, shiftId: string, operationId: string, database: Pick<Pool, "connect"> = pool, claim = false) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await lockShiftSchedulingRows(client, session.userId!, shiftId);
    await currentGateShift(client, session, shiftId, !claim);
    const rows = await client.query("SELECT result_json FROM work_hub_client_operations WHERE user_id=$1 AND command_kind=$2 AND operation_id=$3 AND owner_org_type='vendor' AND owner_org_id=$4", [session.userId, claim ? "shift.gate.claim" : kind, operationId, session.vendorId]);
    await currentGateShift(client, session, shiftId, !claim);
    const receipt = rows.rows.length ? GateShiftAssignmentReceiptSchema.parse(rows.rows[0].result_json) : null;
    if (receipt && receipt.shiftId !== shiftId) throw new GateShiftAssignmentError("work_hub.not_found", 404);
    await client.query("COMMIT"); return { receipt };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export function executeGateShiftClaim(session: SessionPayload, shiftId: string, raw: unknown, database: Pick<Pool, "connect"> = pool) {
  const input = GateShiftClaimInputSchema.parse(raw);
  return executeGateShiftAssignment(session, shiftId, { ...input, assigneeUserIds: [session.userId] }, database, true);
}

/** Reads the original actor's saved creation operation, after current authority on its exact shift. */
export async function readShiftCreationOperation(session: SessionPayload, operationId: string, database: Pick<Pool, "connect"> = pool) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    let fresh = await validateAssistantSession(session, drizzle(client, { schema }));
    const found = await client.query("SELECT * FROM work_hub_client_operations WHERE user_id=$1 AND command_kind='shift.create' AND operation_id=$2", [session.userId, operationId]);
    if (!found.rows.length) { await client.query("COMMIT"); return { receipt: null }; }
    const operation = found.rows[0], resource = operation.result_json;
    const ownerId = operation.owner_org_type === "vendor" ? fresh.vendorId : fresh.partnerId;
    if (!resource || !operation.applied_at || ownerId !== operation.owner_org_id || resource.ownerOrgType !== operation.owner_org_type
      || resource.ownerOrgId !== ownerId || resource.createdById !== fresh.userId) throw new GateShiftAssignmentError("work_hub.not_found", 404);
    await lockShiftSchedulingRows(client,session.userId!,resource.id);
    await client.query("SELECT id FROM user_org_memberships WHERE user_id=$1 ORDER BY id FOR SHARE", [session.userId]);
    fresh=await validateAssistantSession(session,drizzle(client,{schema}));
    if ((operation.owner_org_type === "vendor" ? fresh.vendorId : fresh.partnerId) !== ownerId || fresh.userId !== resource.createdById) throw new GateShiftAssignmentError("work_hub.not_found", 404);
    const current = await client.query("SELECT * FROM work_hub_shifts WHERE id=$1 AND owner_org_type=$2 AND owner_org_id=$3 FOR SHARE", [resource.id, operation.owner_org_type, ownerId]);
    if (!current.rows.length) throw new GateShiftAssignmentError("work_hub.not_found", 404);
    if (current.rows[0].gate_station_id) await authorizeGateSchedulingSite(client, session, current.rows[0].site_location_id, current.rows[0].gate_station_id);
    else requireWorkHubCapability(createWorkHubAccess({ session: { ...fresh, userId: fresh.userId! }, owner: { type: operation.owner_org_type, id: ownerId! }, context: { kind: "organization", id: ownerId! }, participant: false }), "shift.manage");
    const receipt = { operationId, appliedAt: new Date(operation.applied_at).toISOString(), replayed: true, resource };
    await client.query("COMMIT"); return { receipt };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
