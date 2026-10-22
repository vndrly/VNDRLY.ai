import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { WorkforceOfferInputSchema, WorkforceOfferResponseInputSchema, WorkforceOfferSchema, WorkforceOffersSchema, WorkforceIncomingOffersSchema, WorkforceOfferReceiptSchema, workforceOfferFingerprintValues, workforceOfferResponseFingerprintValues, type WorkforceOfferReceipt } from "@workspace/api-zod";
import type { Pool, PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import { guardGateShiftAssignments, lockShiftSchedulingRows, GateShiftAssignmentError } from "./gate-shift-assignment";
import { workforceActor, currentWorkforceGateShift } from "./workforce-roster";

const createKind = "shift.gate.offer", respondKind = "shift.gate.offer.respond";
const iso = (value: unknown) => new Date(String(value)).toISOString();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function project(row: Record<string, any>) {
  return WorkforceOfferSchema.parse({ id: row.id, shiftId: row.shift_id, workerUserId: row.target_user_id,
    workerName: row.worker_name, status: row.status, createdAt: iso(row.created_at), decidedAt: row.decided_at ? iso(row.decided_at) : null });
}
async function transaction<T>(database: Pick<Pool, "connect">, work: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='15s'");
    const result = await work(client);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
async function receiptFor(client: PoolClient, session: SessionPayload, shiftId: string, operationId: string, kind: string) {
  const found = await client.query("SELECT result_json FROM work_hub_client_operations WHERE user_id=$1 AND command_kind=$2 AND operation_id=$3 AND owner_org_type='vendor' AND owner_org_id=$4", [session.userId, kind, operationId, session.vendorId]);
  if (!found.rows.length) return null;
  const receipt = WorkforceOfferReceiptSchema.parse(found.rows[0].result_json);
  if (receipt.shiftId !== shiftId || receipt.actorUserId !== session.userId) throw new GateShiftAssignmentError("work_hub.operation_conflict");
  return receipt;
}
async function saveReceipt(client: PoolClient, session: SessionPayload, kind: string, receipt: WorkforceOfferReceipt) {
  await client.query("INSERT INTO work_hub_client_operations(user_id,command_kind,operation_id,owner_org_type,owner_org_id,result_json,applied_at) VALUES($1,$2,$3,'vendor',$4,$5::jsonb,now())", [session.userId, kind, receipt.operationId, session.vendorId, JSON.stringify(receipt)]);
  await client.query("INSERT INTO work_hub_audit_log(actor_user_id,owner_org_type,owner_org_id,action,subject_type,subject_id,prior_version,new_version,source,operation_id,metadata) VALUES($1,'vendor',$2,$3,'shift',$4,$5,$6,'web',$7,$8::jsonb)",
    [session.userId, session.vendorId, kind, receipt.shiftId, receipt.previousVersion, receipt.resultingVersion, receipt.operationId, JSON.stringify({ offerId: receipt.offerId, workerUserId: receipt.workerUserId, status: receipt.status, assignmentRecorded: receipt.assignmentRecorded, physicalAttendanceVerified: false })]);
}
function assertOpenForOffer(shift: Record<string, any>) {
  if (shift.recurrence != null || shift.milestone_status !== "upcoming" || new Date(shift.starts_at).getTime() <= Date.now() || new Date(shift.ends_at).getTime() <= Date.now())
    throw new GateShiftAssignmentError("workforce.offer_shift_unavailable");
}
async function assertCapacity(client: PoolClient, shift: Record<string, any>, workerUserId: number) {
  const assigned = (await client.query("SELECT user_id,status FROM work_hub_shift_assignments WHERE shift_id=$1 ORDER BY user_id FOR SHARE", [shift.id])).rows;
  // Reinstating a declined/cancelled row would be a different assignment operation.
  if (assigned.some(row => row.user_id === workerUserId)) throw new GateShiftAssignmentError("workforce.already_assigned");
  if (assigned.filter(row => ["assigned", "accepted", "claimed"].includes(row.status)).length >= (shift.required_staff_count ?? 1))
    throw new GateShiftAssignmentError("workforce.capacity_filled");
}

/** Persist an invitation only. An offer never reserves capacity or assigns its recipient. */
export async function createWorkforceOffer(session: SessionPayload, shiftId: string, raw: unknown, database: Pick<Pool, "connect"> = pool) {
  const input = WorkforceOfferInputSchema.parse(raw);
  const fingerprint = hash(workforceOfferFingerprintValues(shiftId, session.userId!, session.vendorId!, input));
  return transaction(database, async client => {
    await lockShiftSchedulingRows(client, session.userId!, shiftId, [input.workerUserId]);
    await currentWorkforceGateShift(client, session, shiftId);
    const prior = await receiptFor(client, session, shiftId, input.operationId, createKind);
    if (prior) { if (prior.commandFingerprint !== fingerprint) throw new GateShiftAssignmentError("work_hub.operation_conflict"); return prior; }
    const { shift } = await guardGateShiftAssignments(client, session, shiftId, [input.workerUserId]);
    if (shift.version !== input.expectedVersion) throw new GateShiftAssignmentError("work_hub.version_conflict");
    assertOpenForOffer(shift); await assertCapacity(client, shift, input.workerUserId);
    const duplicate = await client.query("SELECT id FROM work_hub_shift_requests WHERE shift_id=$1 AND request_type='offer' AND target_user_id=$2 AND status='pending' FOR UPDATE", [shiftId, input.workerUserId]);
    if (duplicate.rows.length) throw new GateShiftAssignmentError("workforce.offer_pending");
    const offer = (await client.query("INSERT INTO work_hub_shift_requests(shift_id,request_type,requested_by_id,target_user_id,status,warning_snapshot) VALUES($1,'offer',$2,$3,'pending','[]'::jsonb) RETURNING id", [shiftId, session.userId, input.workerUserId])).rows[0];
    const receipt = WorkforceOfferReceiptSchema.parse({ operationId: input.operationId, actorUserId: session.userId, shiftId, offerId: offer.id, workerUserId: input.workerUserId,
      status: "pending", previousVersion: shift.version, resultingVersion: shift.version, assignmentRecorded: false, commandFingerprint: fingerprint, recordedAt: new Date().toISOString() });
    await saveReceipt(client, session, createKind, receipt); return receipt;
  });
}

export async function listWorkforceShiftOffers(session: SessionPayload, shiftId: string, database: Pick<Pool, "connect"> = pool) {
  return transaction(database, async client => {
    await lockShiftSchedulingRows(client, session.userId!, shiftId);
    const shift = await currentWorkforceGateShift(client, session, shiftId);
    const offers = await client.query(`SELECT r.*,u.display_name AS worker_name FROM work_hub_shift_requests r JOIN users u ON u.id=r.target_user_id
      WHERE r.shift_id=$1 AND r.request_type='offer' ORDER BY r.created_at,r.id`, [shiftId]);
    return WorkforceOffersSchema.parse({ shiftVersion: shift.version, offers: offers.rows.map(project) });
  });
}

export async function listIncomingWorkforceOffers(session: SessionPayload, database: Pick<Pool, "connect"> = pool) {
  return transaction(database, async client => {
    await workforceActor(client, session);
    const rows = (await client.query(`SELECT r.*,u.display_name AS worker_name,s.title,s.starts_at,s.ends_at,s.version FROM work_hub_shift_requests r
      JOIN work_hub_shifts s ON s.id=r.shift_id JOIN users u ON u.id=r.target_user_id
      WHERE r.target_user_id=$1 AND r.request_type='offer' AND s.owner_org_type='vendor' AND s.owner_org_id=$2
      ORDER BY r.created_at DESC,r.id`, [session.userId, session.vendorId])).rows;
    const offers = [];
    for (const row of rows) {
      try { await currentWorkforceGateShift(client, session, row.shift_id, false); }
      catch (error) {
        if (error instanceof GateShiftAssignmentError && [403, 404].includes(error.status)) continue;
        // Revoked site authority hides the incoming offer; session errors still fail closed.
        if (error instanceof Error && "status" in error && error.status === 403) continue;
        throw error;
      }
      offers.push({ ...project(row), shiftTitle: row.title, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), shiftVersion: row.version });
    }
    return WorkforceIncomingOffersSchema.parse({ offers });
  });
}

/** Recipient acceptance adds only that recipient under the canonical scheduling locks. */
export async function respondWorkforceOffer(session: SessionPayload, shiftId: string, offerId: string, raw: unknown, database: Pick<Pool, "connect"> = pool) {
  const input = WorkforceOfferResponseInputSchema.parse(raw);
  const fingerprint = hash(workforceOfferResponseFingerprintValues(shiftId, offerId, session.userId!, session.vendorId!, input));
  return transaction(database, async client => {
    await lockShiftSchedulingRows(client, session.userId!, shiftId, [session.userId!]);
    let shift = await currentWorkforceGateShift(client, session, shiftId, false);
    const found = await client.query("SELECT * FROM work_hub_shift_requests WHERE id=$1 AND shift_id=$2 AND request_type='offer' AND target_user_id=$3 FOR UPDATE", [offerId, shiftId, session.userId]);
    if (!found.rows.length) throw new GateShiftAssignmentError("work_hub.not_found", 404);
    const prior = await receiptFor(client, session, shiftId, input.operationId, respondKind);
    if (prior) { if (prior.commandFingerprint !== fingerprint) throw new GateShiftAssignmentError("work_hub.operation_conflict"); return prior; }
    if (found.rows[0].status !== "pending") throw new GateShiftAssignmentError("workforce.offer_decided");
    if (shift.version !== input.expectedVersion) throw new GateShiftAssignmentError("work_hub.version_conflict");
    if (input.decision === "accepted") {
      ({ shift } = await guardGateShiftAssignments(client, session, shiftId, [session.userId!], false));
      assertOpenForOffer(shift); await assertCapacity(client, shift, session.userId!);
      await client.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id,assigned_by_id,status) VALUES($1,$2,$3,'accepted')", [shiftId, session.userId, found.rows[0].requested_by_id]);
      const updated = await client.query("UPDATE work_hub_shifts SET version=version+1,open=false,updated_at=now() WHERE id=$1 AND version=$2 RETURNING version", [shiftId, input.expectedVersion]);
      if (updated.rows.length !== 1) throw new GateShiftAssignmentError("work_hub.version_conflict");
      // Gate coverage state and actual_count describe physical duty. Never mark a post covered from an invitation response.
      await client.query(`INSERT INTO workforce_coverage_records(shift_id,gate_station_id,vacancy_origin,required_count,assigned_count,actual_count,coverage_kind,state)
        SELECT s.id,s.gate_station_id,'gate_schedule',coalesce(s.required_staff_count,1),count(a.id)::int,0,'gate','uncovered'
        FROM work_hub_shifts s LEFT JOIN work_hub_shift_assignments a ON a.shift_id=s.id AND a.status IN ('assigned','accepted','claimed') WHERE s.id=$1 GROUP BY s.id
        ON CONFLICT(shift_id) DO UPDATE SET assigned_count=excluded.assigned_count,version=workforce_coverage_records.version+1,updated_at=now()`, [shiftId]);
    }
    await client.query("UPDATE work_hub_shift_requests SET status=$2,decided_by_id=$3,decided_at=now() WHERE id=$1 AND status='pending'", [offerId, input.decision, session.userId]);
    const receipt = WorkforceOfferReceiptSchema.parse({ operationId: input.operationId, actorUserId: session.userId, shiftId, offerId, workerUserId: session.userId,
      status: input.decision, previousVersion: input.expectedVersion, resultingVersion: input.expectedVersion + (input.decision === "accepted" ? 1 : 0),
      assignmentRecorded: input.decision === "accepted", commandFingerprint: fingerprint, recordedAt: new Date().toISOString() });
    await saveReceipt(client, session, respondKind, receipt); return receipt;
  });
}

export async function readWorkforceOfferOperation(session: SessionPayload, shiftId: string, operationId: string, database: Pick<Pool, "connect"> = pool) {
  return transaction(database, async client => {
    await lockShiftSchedulingRows(client, session.userId!, shiftId);
    await workforceActor(client, session);
    const created = await receiptFor(client, session, shiftId, operationId, createKind);
    const responded = await receiptFor(client, session, shiftId, operationId, respondKind);
    const receipt = created ?? responded;
    await currentWorkforceGateShift(client, session, shiftId, Boolean(created));
    return { receipt };
  });
}
