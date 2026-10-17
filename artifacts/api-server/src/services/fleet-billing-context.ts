import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import type { PoolClient } from "pg";
import {
  FleetTicketPlanSchema,
  FleetTicketBillingV2Schema,
} from "@workspace/api-zod";
import { FleetError } from "./fleet-repository";

// Validate the entire old shape without inserting defaults into the retained
// original; legacy readers normalize only after verifying its exact digest.
const proofSchema = z
  .object({
    companyId: z.number().int().positive(),
    ticketId: z.number().int().positive(),
    originalPlan: z
      .unknown()
      .refine(
        (value) => FleetTicketPlanSchema.safeParse(value).success,
        "Actual legacy plan required",
      ),
  })
  .strict();
const reference = (proof: z.infer<typeof proofSchema>) =>
  `fleet-legacy-plan:${createHash("sha256")
    .update(
      JSON.stringify({
        companyId: proof.companyId,
        ticketId: proof.ticketId,
        originalPlan: proof.originalPlan,
      }),
    )
    .digest("hex")}`;
/** Records the actual existing plan before a parent gains v2 billing. Never
 * reconstructs a historical rate from a live catalog or from a new run. */
export async function retainLegacyFleetBillingPlan(
  client: PoolClient,
  actor: { userId: number; companyId: number },
  ticket: {
    id: number;
    vendor_id: number;
    site_location_id: number;
    fleet_plan: unknown;
  },
) {
  const plan = FleetTicketPlanSchema.parse(ticket.fleet_plan);
  if (
    ticket.vendor_id !== actor.companyId ||
    plan.vendorId !== actor.companyId ||
    plan.siteId !== ticket.site_location_id
  )
    throw new FleetError("fleet.ticket_origin_locked", 409);
  const proof = {
      companyId: actor.companyId,
      ticketId: ticket.id,
      originalPlan: ticket.fleet_plan,
    },
    id = reference(proof);
  const prior = await client.query(
    "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-legacy-plan' AND target_id=$2 ORDER BY id LIMIT 1",
    [actor.companyId, id],
  );
  if (prior.rows.length) {
    if (!isDeepStrictEqual(proofSchema.parse(prior.rows[0].tool_output), proof))
      throw new FleetError("fleet.operation_conflict");
  } else
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','derived','canonical','fleet_legacy_plan','legacy-plan-retained','fleet-legacy-plan',$3,$4::jsonb,'completed')",
      [actor.userId, actor.companyId, id, JSON.stringify(proof)],
    );
  return { plan, reference: id };
}
/** Internal legacy writer view. A newly created v2 ticket has no implied old
 * price. Actual old runs use only their retained original v1 plan. */
export async function readLegacyFleetBillingPlan(
  client: PoolClient,
  companyId: number,
  ticketId: number,
  raw: unknown,
) {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("billingVersion" in raw) ||
    raw.billingVersion !== 2
  )
    return FleetTicketPlanSchema.parse(raw);
  const current = FleetTicketBillingV2Schema.parse(raw);
  if (current.vendorId !== companyId || !current.legacyPlanReference)
    throw new FleetError("fleet.legacy_finance_unavailable", 409);
  const rows = await client.query(
    "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-legacy-plan' AND target_id=$2 ORDER BY id LIMIT 1",
    [companyId, current.legacyPlanReference],
  );
  if (!rows.rows.length)
    throw new FleetError("fleet.legacy_finance_unavailable", 409);
  const proof = proofSchema.parse(rows.rows[0].tool_output);
  if (
    proof.companyId !== companyId ||
    proof.ticketId !== ticketId ||
    reference(proof) !== current.legacyPlanReference
  )
    throw new FleetError("fleet.legacy_finance_unavailable", 409);
  const prior = FleetTicketPlanSchema.parse(proof.originalPlan);
  if (
    prior.vendorId !== current.vendorId ||
    prior.partnerId !== current.partnerId ||
    prior.siteId !== current.billingSiteId ||
    prior.afeNumber !== current.afeNumber ||
    prior.workDate !== current.workDate ||
    prior.currency !== current.currency
  )
    throw new FleetError("fleet.ticket_origin_locked", 409);
  return prior;
}
