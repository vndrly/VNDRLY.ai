import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { sameWorkdayOwner, type WorkdayScope } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { createWorkdayService, withVerifiedWorkdayClient } from "./workday";
import { ChangeOverError } from "./gate-change-over";

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
