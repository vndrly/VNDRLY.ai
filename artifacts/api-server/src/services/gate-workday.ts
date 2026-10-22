import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { sameWorkdayOwner, WorkdayScopeSchema, type WorkdayScope } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { createWorkdayService, withVerifiedWorkdayClient } from "./workday";
import { ChangeOverError, requireChangeOverAccess } from "./gate-change-over";

function operationId(sourceId: string, userId: number, action: string) {
  const hex = createHash("sha256")
    .update(`gate-workday:${sourceId}:${userId}:${action}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
type Binding = {
  owner: WorkdayScope["owner"];
  workerUserId: number;
  shiftId: string;
};
const mismatch = () =>
  new ChangeOverError(
    409,
    "change_over.employer_context_changed",
    "Switch back to the company where this Gate shift began before handing it off.",
  );
/** Reference the one canonical Work Hub clock; these receipts never constitute
 * another timecard. Caller owns the Gate transaction, including notes/coverage. */
export async function recordGateWorkday(
  client: PoolClient,
  session: SessionPayload,
  action: "start_shift" | "end_shift",
  sourceId: string,
  at: Date,
  timezone = "America/Chicago",
  aliases: string[] = [],
): Promise<void> {
  if (!session.vendorId && !session.partnerId) return;
  const clock = createWorkdayService((actor, work) =>
      withVerifiedWorkdayClient(actor, client, work),
    ),
    current = await clock.current(session);
  const sources = [...new Set([sourceId, ...aliases])],
    bindings = new Map<string, Binding>();
  const coverage = (
    await client.query(
      "SELECT d.post_coverage FROM gate_duty_sessions d LEFT JOIN gate_shifts s ON s.station_id=d.station_id AND s.operator_id=d.user_id WHERE d.user_id=$1 AND d.ended_at IS NULL AND (d.id=ANY($2::uuid[]) OR s.id=ANY($2::uuid[]))",
      [current.scope.userId, sources],
    )
  ).rows;
  if (
    coverage.some(
      (row) =>
        (row.post_coverage?.vendorId &&
          row.post_coverage.vendorId !== session.vendorId) ||
        (row.post_coverage?.partnerId &&
          row.post_coverage.partnerId !== session.partnerId),
    )
  )
    throw mismatch();
  for (const source of sources) {
    const row = (
      await client.query(
        "SELECT tool_output FROM assistant_action_audit WHERE user_id=$1 AND target_type='gate-workday-binding' AND target_id=$2 ORDER BY id DESC LIMIT 1",
        [current.scope.userId, source],
      )
    ).rows[0];
    if (row) {
      const binding = row.tool_output as Binding;
      if (
        binding.workerUserId !== current.scope.userId ||
        !sameWorkdayOwner(binding.owner, current.scope.owner)
      )
        throw mismatch();
      bindings.set(source, binding);
    }
  }
  const bound = bindings.values().next().value as Binding | undefined;
  if (
    bound &&
    [...bindings.values()].some((value) => value.shiftId !== bound.shiftId)
  )
    throw mismatch();
  if (action === "end_shift") {
    // A pre-update Gate record is not evidence that today's unrelated clock
    // belongs to it. Preserve that clock rather than invent a historical link.
    if (!bound) {
      if (current.workday)
        throw new ChangeOverError(
          409,
          "change_over.clock_binding_required",
          "Assume Shift in the original company before completing this older Gate handoff; no employee hours were changed.",
        );
      return;
    }
    const saved = await clock.read(session, bound.shiftId);
    if (saved.summary.endedAt) return;
    if (current.workday?.id !== bound.shiftId) throw mismatch();
    await clock.record(session, {
      operationId: operationId(sourceId, current.scope.userId, action),
      shiftId: bound.shiftId,
      scope: current.scope,
      action,
      capturedAt: at.toISOString(),
      timezone: saved.timezone,
    });
    return;
  }
  if (bound) {
    const saved = await clock.read(session, bound.shiftId);
    if (saved.summary.endedAt) return; // Retrying an old Assume never opens a new day.
    if (current.workday?.id !== bound.shiftId) throw mismatch();
  }
  let shiftId = bound?.shiftId ?? current.workday?.id;
  if (!shiftId) {
    shiftId = operationId(sourceId, current.scope.userId, "shift");
    await clock.record(session, {
      operationId: operationId(sourceId, current.scope.userId, action),
      shiftId,
      scope: current.scope,
      action,
      capturedAt: at.toISOString(),
      timezone,
    });
  }
  const binding: Binding = {
    owner: current.scope.owner,
    workerUserId: current.scope.userId,
    shiftId,
  };
  for (const source of sources)
    if (!bindings.has(source))
      await client.query(
        "INSERT INTO assistant_action_audit(user_id,vendor_id,partner_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,$3,$4,'work-hub','typed','canonical','workday','gate-clock-reference','gate-workday-binding',$5,$6::jsonb,'completed')",
        [
          current.scope.userId,
          current.scope.owner.type === "vendor" ? current.scope.owner.id : null,
          current.scope.owner.type === "partner"
            ? current.scope.owner.id
            : null,
          session.role ?? "unknown",
          source,
          JSON.stringify(binding),
        ],
      );
}

/** Explicit emergency supervisor action. Resolve the outgoing worker's employer
 * from Gate records, then append to the same canonical clock in this transaction.
 * Suspension/sign-out must not prevent an authorized supervisor closing a shift. */
export async function endGateWorkdayForRecovery(
  client: PoolClient, supervisor: SessionPayload,
  input: { stationId: string; siteId: number; operatorId: number; watchId: string; reason: string; at: Date },
) {
  const access = await requireChangeOverAccess(client, supervisor, input.siteId);
  if (!access.supervisor || supervisor.userId === input.operatorId)
    throw new ChangeOverError(403, "change_over.supervisor_required", "Supervisor access required");
  const duties = (await client.query(
    "SELECT id,post_coverage FROM gate_duty_sessions WHERE station_id=$1 AND user_id=$2 AND ended_at IS NULL FOR UPDATE",
    [input.stationId, input.operatorId],
  )).rows;
  const sources = [input.watchId, ...duties.map(row => row.id)];
  const bindings = (await client.query(
    "SELECT DISTINCT ON(target_id) tool_output FROM assistant_action_audit WHERE user_id=$1 AND target_type='gate-workday-binding' AND target_id=ANY($2::text[]) ORDER BY target_id,id DESC",
    [input.operatorId, sources],
  )).rows.map(row => row.tool_output as Binding);
  const owners = new Map<string, WorkdayScope["owner"]>();
  const addOwner = (owner: WorkdayScope["owner"]) => {
    if (!["vendor", "partner"].includes(owner?.type) || !Number.isSafeInteger(owner.id) || owner.id < 1)
      throw mismatch();
    owners.set(`${owner.type}:${owner.id}`, owner);
  };
  for (const binding of bindings) {
    if (binding.workerUserId !== input.operatorId) throw mismatch();
    addOwner(binding.owner);
  }
  for (const duty of duties) {
    if (duty.post_coverage?.vendorId) addOwner({ type: "vendor", id: duty.post_coverage.vendorId });
    if (duty.post_coverage?.partnerId) addOwner({ type: "partner", id: duty.post_coverage.partnerId });
  }
  const workSessions = (await client.query(
    "SELECT w.owner_org_type,w.owner_org_id FROM gate_work_sessions w WHERE w.user_id=$2 AND w.ended_at IS NULL AND (EXISTS(SELECT 1 FROM gate_duty_sessions d WHERE d.work_session_id=w.id AND d.station_id=$1 AND d.user_id=$2 AND d.ended_at IS NULL) OR EXISTS(SELECT 1 FROM work_hub_shifts s WHERE s.id=w.work_hub_shift_id AND s.gate_station_id=$1)) FOR UPDATE OF w",
    [input.stationId, input.operatorId],
  )).rows;
  for (const work of workSessions) addOwner({ type: work.owner_org_type, id: work.owner_org_id });
  // Legacy watches have no clock binding. Only a single current Gate employer
  // qualifies; never guess between companies or end an unrelated employer clock.
  if (!owners.size) {
    const memberships = (await client.query(
      `SELECT DISTINCT m.org_type,coalesce(m.vendor_id,m.partner_id) AS owner_id
       FROM user_org_memberships m WHERE m.user_id=$1 AND (
        (m.org_type='vendor' AND EXISTS(SELECT 1 FROM site_work_assignments a WHERE a.vendor_id=m.vendor_id AND a.site_location_id=$2 AND a.is_gate_contractor=true) AND ($3::int IS NULL OR m.vendor_id=$3))
        OR (m.org_type='partner' AND m.partner_id=$4 AND $3::int IS NULL))`,
      [input.operatorId, input.siteId, supervisor.vendorId ?? null, access.site.partner_id],
    )).rows;
    for (const member of memberships) addOwner({ type: member.org_type, id: member.owner_id });
  }
  if (!owners.size) return null; // A platform-only operator has no employer clock.
  if (owners.size !== 1) throw mismatch();
  const owner = [...owners.values()][0]!;
  if (supervisor.vendorId && (owner.type !== "vendor" || owner.id !== supervisor.vendorId)) throw mismatch();
  const member = (await client.query(
    "SELECT m.id,u.session_version FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.org_type=$2 AND CASE WHEN m.org_type='vendor' THEN m.vendor_id ELSE m.partner_id END=$3 ORDER BY m.id LIMIT 1",
    [input.operatorId, owner.type, owner.id],
  )).rows[0];
  if (!member) throw mismatch();
  const scope = WorkdayScopeSchema.parse({ owner, userId: input.operatorId, membershipId: member.id, sessionVersion: member.session_version });
  // Authority is the real, freshly checked supervisor, not an impersonated login.
  const clock = createWorkdayService(async (_actor, work) => work(client, scope));
  const current = await clock.current(supervisor);
  const bound = bindings[0];
  if (bindings.some(binding => binding.shiftId !== bound?.shiftId)) throw mismatch();
  if (bound) {
    const saved = await clock.read(supervisor, bound.shiftId);
    if (saved.summary.endedAt) {
      if (current.workday) throw mismatch();
      return null;
    }
    if (current.workday?.id !== bound.shiftId) throw mismatch();
  }
  if (!current.workday) return null;
  const receipt = await clock.record(supervisor, {
    operationId: operationId(input.watchId, input.operatorId, "supervisor_recovery"),
    shiftId: current.workday.id, scope, action: "end_shift",
    capturedAt: input.at.toISOString(), timezone: current.workday.timezone,
  });
  await client.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,partner_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,$3,$4,'work-hub','typed','canonical','gate-recovery','supervisor-end-shift','gate-recovery-clock',$5,$6::jsonb,'completed')",
    [supervisor.userId, owner.type === "vendor" ? owner.id : null, owner.type === "partner" ? owner.id : null, supervisor.role,
      input.watchId, JSON.stringify({ supervisorUserId: supervisor.userId, workerUserId: input.operatorId, reason: input.reason, reportedByOperator: false, receipt })],
  );
  return receipt;
}
