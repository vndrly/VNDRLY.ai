import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import {
  FleetWorkMappingSchema,
  FleetWorkScopeSchema,
  FleetRunSchema,
  type FleetWorkScope,
  type FleetWorkReference,
  type FleetDetailSnapshot,
} from "@workspace/api-zod";
import { FleetError } from "./fleet-repository";
import type { FleetWorkExecutionContext } from "./fleet-work-repository";
type Canonical = Extract<FleetWorkReference, { type: "canonical" }>;
const mappingSchema = z
  .object({ scope: FleetWorkScopeSchema, mapping: FleetWorkMappingSchema })
  .strict();
export async function resolveFleetWorkReference(
  { actor, client }: FleetWorkExecutionContext,
  scope: FleetWorkScope,
  ref: FleetWorkReference,
): Promise<Canonical> {
  if (ref.type === "canonical") return ref;
  const rows = await client.query(
    "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-mapping' AND target_id=$2 ORDER BY id DESC LIMIT 1",
    [actor.companyId, `${scope.provisioningId}:${ref.kind}:${ref.id}`],
  );
  const row = rows.rows[0],
    parsed = mappingSchema.safeParse(row?.tool_output);
  if (
    row?.user_id !== actor.userId ||
    !parsed.success ||
    !isDeepStrictEqual(parsed.data.scope, scope) ||
    !isDeepStrictEqual(parsed.data.mapping.local, ref)
  )
    throw new FleetError("fleet.work_dependency_unresolved", 409);
  return parsed.data.mapping.canonical;
}
/** Performed facts attach to a real saved assignment, not a client assertion
 * of today's equipment. The surrounding transaction verifies session/device;
 * this guard verifies current driver/company access and original ticket. */
export async function authorizeFleetOriginalDriverActivity(
  context: FleetWorkExecutionContext,
  scope: FleetWorkScope,
  activityRef: FleetWorkReference,
  ticketRef: FleetWorkReference,
  assignment?: FleetDetailSnapshot,
) {
  const { actor, state, client } = context;
  if (actor.readOnly || !state.enabled)
    throw new FleetError("fleet.action_forbidden", 403);
  const activity = await resolveFleetWorkReference(context, scope, activityRef),
    ticket = await resolveFleetWorkReference(context, scope, ticketRef);
  if (activity.kind !== "activity" || ticket.kind !== "ticket")
    throw new FleetError("fleet.invalid_request", 400);
  const rows = await client.query(
    "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 AND tool_output->>'version'=$3 ORDER BY id DESC LIMIT 1",
    [actor.companyId, activity.id, String(activity.version)],
  );
  if (!rows.rows.length) throw new FleetError("fleet.work_assignment_changed");
  const original = FleetRunSchema.parse(rows.rows[0].tool_output),
    grant = state.grants.find((g) => g.userId === actor.userId);
  if (
    original.companyId !== actor.companyId ||
    original.driverUserId !== actor.userId ||
    !grant?.roles.includes("driver") ||
    !grant.fleetIds.includes(original.fleetId) ||
    !state.fleets.some((g) => g.id === original.fleetId)
  )
    throw new FleetError("fleet.action_forbidden", 403);
  if (
    !original.resourceAssignment ||
    (assignment &&
      !isDeepStrictEqual(original.resourceAssignment.snapshot, assignment)) ||
    original.linkedTicketId !== ticket.id
  )
    throw new FleetError("fleet.work_assignment_changed");
  const parent = await client.query(
    "SELECT id FROM tickets WHERE id=$1 AND vendor_id=$2",
    [ticket.id, actor.companyId],
  );
  if (!parent.rows.length)
    throw new FleetError("fleet.work_assignment_changed");
  return { original, ticket, activity };
}
