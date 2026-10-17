import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import {
  FleetWorkBillingIntentSchema,
  FleetPricingIntentSchema,
  FleetRunBillingV2Schema,
  FleetTicketBillingV2Schema,
  FleetBillingModeSchema,
  type FleetRun,
} from "@workspace/api-zod";
import type { FleetWorkExecutionContext } from "./fleet-work-repository";
import { FleetError } from "./fleet-repository";
import { resolveFleetRateAuthority } from "./fleet-rate-authority";
import { retainLegacyFleetBillingPlan } from "./fleet-billing-context";
import { FleetTicketPlanSchema } from "@workspace/api-zod";

const open = new Set([
  "initiated",
  "draft",
  "in_progress",
  "pending_review",
  "kicked_back",
  "completed",
]);
const captureSchema = z
  .object({
    workAt: z.iso.datetime({ offset: true }),
    pricingIntent: FleetPricingIntentSchema,
  })
  .strict();
/** Internal binding step inside the authenticated outer create/receipt
 * transaction. The caller still performs canonical resource/reservation/route
 * checks. This never dispatches, approves a charge or submits a ticket. */
export async function attachFleetBillingV2(
  context: FleetWorkExecutionContext,
  run: FleetRun,
  raw: z.infer<typeof FleetWorkBillingIntentSchema>,
  capture: z.infer<typeof captureSchema>,
) {
  const { actor, state, client } = context,
    intent = FleetWorkBillingIntentSchema.parse(raw),
    original = captureSchema.parse(capture),
    grant = state.grants.find((g) => g.userId === actor.userId),
    group = state.fleets.find((g) => g.id === run.fleetId);
  if (
    actor.readOnly ||
    !state.enabled ||
    run.companyId !== actor.companyId ||
    !group ||
    !grant?.fleetIds.includes(group.id) ||
    !grant.roles.some((r) => r === "fleet_manager" || r === "dispatcher") ||
    !grant.siteIds.includes(intent.billingSiteId ?? 0) ||
    !group.siteIds.includes(intent.billingSiteId ?? 0)
  )
    throw new FleetError("fleet.dispatch_required", 403);
  if (
    intent.partnerId === null ||
    intent.billingSiteId === null ||
    intent.serviceId === null
  )
    throw new FleetError("fleet.price_context_unresolved", 409);
  if (
    run.billing ||
    run.commercial ||
    run.billingV2 ||
    run.linkedTicketId !== null
  )
    throw new FleetError("fleet.billing_ticket_mismatch", 409);
  if (run.stops[0]?.siteId !== intent.billingSiteId)
    throw new FleetError("fleet.billing_ticket_mismatch", 409);
  const billingContext = {
    partnerId: intent.partnerId,
    billingSiteId: intent.billingSiteId,
    afeNumber: intent.afeNumber,
    workDate: intent.workDate,
    currency: intent.currency,
  };
  let pricing = await resolveFleetRateAuthority(client, actor, {
    billingContext,
    serviceId: intent.serviceId,
    workAt: original.workAt,
    approvalRef:
      original.pricingIntent.mode === "priced"
        ? original.pricingIntent.rateCard.approvalRef
        : null,
    purpose: "capture",
  });
  const approval = (
    await client.query(
      "SELECT approved_currency FROM partner_vendor_work_type_approvals WHERE vendor_id=$1 AND partner_id=$2 AND work_type_id=$3 FOR SHARE",
      [actor.companyId, intent.partnerId, intent.serviceId],
    )
  ).rows[0];
  if (approval?.approved_currency !== intent.currency)
    throw new FleetError("fleet.price_currency_unresolved", 409);
  if (
    original.pricingIntent.mode === "priced" &&
    (pricing.mode !== "priced" ||
      !isDeepStrictEqual(pricing.rateCard, original.pricingIntent.rateCard))
  )
    throw new FleetError("fleet.price_reference_changed", 409);
  if (
    intent.agreementReference !== null &&
    (pricing.mode !== "priced" ||
      pricing.rateCard.approvalRef.id !== intent.agreementReference)
  )
    pricing = {
      mode: "unpriced",
      reason: "agreement_unresolved",
      serviceId: intent.serviceId,
      approvalRef:
        original.pricingIntent.mode === "priced"
          ? original.pricingIntent.rateCard.approvalRef
          : original.pricingIntent.approvalRef,
    };
  const site = (
    await client.query(
      "SELECT fleet_ticket_policy FROM site_locations WHERE id=$1 AND partner_id=$2 FOR SHARE",
      [intent.billingSiteId, intent.partnerId],
    )
  ).rows[0];
  if (!site) throw new FleetError("fleet.billing_ticket_mismatch", 409);
  const policy = z
    .object({
      version: z.literal(1).optional(),
      mode: FleetBillingModeSchema.nullable().optional(),
    })
    .passthrough()
    .nullable()
    .safeParse(site.fleet_ticket_policy ?? null);
  if (!policy.success)
    throw new FleetError("fleet.billing_policy_unavailable", 409);
  const mode = policy.data?.mode ?? null;
  let ticketId: number, plan: z.infer<typeof FleetTicketBillingV2Schema>;
  if (intent.choice === "new_ticket") {
    plan = FleetTicketBillingV2Schema.parse({
      billingVersion: 2,
      version: 2,
      revision: 1,
      vendorId: actor.companyId,
      partnerId: intent.partnerId,
      billingSiteId: intent.billingSiteId,
      afeNumber: intent.afeNumber,
      workDate: intent.workDate,
      currency: intent.currency,
      batchingAllowed: mode !== "singles",
      serviceIds: [intent.serviceId],
      reviewedChargeIds: [],
      finalizedAt: null,
      finalizationOperationId: null,
    });
    const inserted = await client.query(
      "INSERT INTO tickets(site_location_id,vendor_id,work_type_id,status,lifecycle_state,intake_channel,description,created_by_id,fleet_plan) VALUES($1,$2,$3,'initiated','pending_arrival','office_on_behalf_of_field_employee',$4,$5,$6::jsonb) RETURNING id",
      [
        intent.billingSiteId,
        actor.companyId,
        intent.serviceId,
        run.title,
        actor.userId,
        JSON.stringify(plan),
      ],
    );
    ticketId = inserted.rows[0].id;
  } else {
    if (
      intent.ticket.type !== "canonical" ||
      typeof intent.ticket.id !== "number"
    )
      throw new FleetError("fleet.work_dependency_unresolved", 409);
    const row = (
      await client.query(
        "SELECT id,status,site_location_id,vendor_id,work_type_id,fleet_plan FROM tickets WHERE id=$1 AND vendor_id=$2 FOR UPDATE",
        [intent.ticket.id, actor.companyId],
      )
    ).rows[0];
    if (!row || !open.has(row.status))
      throw new FleetError("fleet.ticket_closed", 409);
    if (row.fleet_plan?.billingVersion !== 2) {
      const legacy = FleetTicketPlanSchema.safeParse(row.fleet_plan);
      if (
        !legacy.success ||
        !legacy.data.billingWorkflow ||
        legacy.data.afeNumber !== intent.afeNumber ||
        legacy.data.workDate !== intent.workDate ||
        legacy.data.vendorId !== actor.companyId ||
        legacy.data.partnerId !== intent.partnerId ||
        legacy.data.siteId !== intent.billingSiteId ||
        legacy.data.currency !== intent.currency
      )
        throw new FleetError("fleet.legacy_price_reconciliation_required", 409);
      const retained = await retainLegacyFleetBillingPlan(client, actor, row);
      plan = FleetTicketBillingV2Schema.parse({
        billingVersion: 2,
        version: 2,
        revision: legacy.data.version,
        legacyPlanReference: retained.reference,
        vendorId: actor.companyId,
        partnerId: intent.partnerId,
        billingSiteId: intent.billingSiteId,
        afeNumber: intent.afeNumber,
        workDate: intent.workDate,
        currency: intent.currency,
        batchingAllowed: legacy.data.mode === "batch",
        serviceIds: [row.work_type_id],
        reviewedChargeIds: [],
        finalizedAt: null,
        finalizationOperationId: null,
      });
    } else plan = FleetTicketBillingV2Schema.parse(row.fleet_plan);
    ticketId = row.id;
    if (plan.finalizedAt !== null || plan.finalizationOperationId !== null)
      throw new FleetError("fleet.ticket_closed", 409);
    if (
      row.site_location_id !== intent.billingSiteId ||
      plan.vendorId !== actor.companyId ||
      plan.partnerId !== intent.partnerId ||
      plan.billingSiteId !== intent.billingSiteId ||
      plan.afeNumber !== intent.afeNumber ||
      plan.workDate !== intent.workDate ||
      plan.currency !== intent.currency
    )
      throw new FleetError("fleet.billing_ticket_mismatch", 409);
    if (!plan.batchingAllowed || mode === "singles")
      throw new FleetError("fleet.ticket_batching_forbidden", 409);
    plan = {
      ...plan,
      revision: plan.revision + 1,
      serviceIds: [...new Set([...plan.serviceIds, intent.serviceId])].sort(
        (a, b) => a - b,
      ),
    };
    await client.query("UPDATE tickets SET fleet_plan=$2::jsonb WHERE id=$1", [
      ticketId,
      JSON.stringify(plan),
    ]);
  }
  run.linkedTicketId = ticketId;
  run.billingV2 = FleetRunBillingV2Schema.parse({
    version: 2,
    revision: 1,
    ticketId,
    ticketRevisionAtBinding: plan.revision,
    context: { vendorId: actor.companyId, ...billingContext },
    serviceId: intent.serviceId,
    pricing,
    requestedAgreementReference: intent.agreementReference,
    reportedPricing: original.pricingIntent,
    review: { status: "pending", reason: null },
  });
  return { ticketId, ticketVersion: plan.revision };
}
