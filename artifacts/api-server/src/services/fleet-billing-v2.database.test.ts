import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@workspace/db";
import {
  FleetRunSchema,
  FleetTicketBillingV2Schema,
  FleetTicketPlanSchema,
  type FleetWorkCommand,
} from "@workspace/api-zod";
import { createFleetPricingFixture } from "../test-utils/fleet-pricing";
import { emptyFleetState } from "./fleet-repository";
import type { FleetWorkExecutionContext } from "./fleet-work-repository";
import { attachFleetBillingV2 } from "./fleet-billing-v2";
import { recordFleetBillingCharge } from "./fleet-billing";
it("binds separate approved run rates to one compatible ticket and keeps unknown price distinct from zero", async () => {
  const f = await createFleetPricingFixture(),
    group = randomUUID(),
    actor = f.manager;
  const state = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: group,
        name: "Synthetic access",
        siteIds: [f.site],
        equipmentAssetIds: [],
        requiredCertifications: [],
      },
    ],
    grants: [
      {
        userId: actor.userId,
        fleetIds: [group],
        siteIds: [f.site],
        roles: ["fleet_manager" as const],
        safetyRelease: false,
        financeRead: true,
      },
    ],
  };
  const make = () =>
    FleetRunSchema.parse({
      id: randomUUID(),
      companyId: f.vendor,
      fleetId: group,
      title: "Synthetic executed order",
      driverUserId: actor.userId,
      vehicleAssetId: randomUUID(),
      trailerAssetId: null,
      siteIds: [f.site],
      status: "draft",
      phase: null,
      version: 1,
      stops: [
        { id: randomUUID(), siteId: f.site, kind: "pickup", sequence: 0 },
      ],
      loads: [],
      inspections: [],
      currentStopId: null,
      visitedStopIds: [],
      events: [],
      linkedTicketId: null,
      allowedActions: [],
    });
  const binding = {
    choice: "new_ticket" as const,
    ticket: {
      type: "local" as const,
      kind: "ticket" as const,
      id: randomUUID(),
    },
    partnerId: f.partner,
    billingSiteId: f.site,
    afeNumber: "AFE1",
    workDate: "2026-10-16",
    currency: "USD" as const,
    serviceId: f.service,
    agreementReference: null,
  };
  type Intent = Extract<
    FleetWorkCommand,
    { kind: "activity.create" }
  >["payload"]["billing"];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const context: FleetWorkExecutionContext = { actor, state, client },
      first = make();
    const initial = await attachFleetBillingV2(context, first, binding, {
      workAt: "2026-10-16T12:00:00Z",
      pricingIntent: {
        mode: "unpriced",
        reason: "offline_reference_missing",
        serviceId: f.service,
        approvalRef: null,
      },
    });
    expect(first.billingV2?.pricing).toMatchObject({
      mode: "priced",
      rateCard: { unitRate: "0.0125" },
    });
    expect(first.billing).toBeUndefined();
    expect(first.commercial).toBeUndefined();
    expect(first.linkedTicketId).toBe(initial.ticketId);
    expect(FleetRunSchema.safeParse(first).success).toBe(true);
    const parent = (
      await client.query("SELECT fleet_plan FROM tickets WHERE id=$1", [
        initial.ticketId,
      ])
    ).rows[0].fleet_plan;
    expect(FleetTicketBillingV2Schema.parse(parent)).toMatchObject({
      version: 2,
      revision: 1,
      afeNumber: "AFE1",
      serviceIds: [f.service],
      finalizedAt: null,
    });
    const unknownAgreement = make();
    await attachFleetBillingV2(
      context,
      unknownAgreement,
      { ...binding, agreementReference: "Unresolved contract label" },
      {
        workAt: "2026-10-16T12:00:00Z",
        pricingIntent: {
          mode: "unpriced",
          reason: "agreement_unresolved",
          serviceId: f.service,
          approvalRef: null,
        },
      },
    );
    expect(unknownAgreement.billingV2).toMatchObject({
      pricing: { mode: "unpriced", reason: "agreement_unresolved" },
      requestedAgreementReference: "Unresolved contract label",
      review: { status: "pending" },
    });
    await expect(
      attachFleetBillingV2(
        { ...context, actor: { ...actor, readOnly: true } },
        make(),
        binding,
        {
          workAt: "2026-10-16T12:00:00Z",
          pricingIntent: {
            mode: "unpriced",
            reason: "approval_required",
            serviceId: f.service,
            approvalRef: null,
          },
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await client.query(
      "UPDATE partner_vendor_work_type_approvals SET precise_unit_price='12',approved_at='2026-10-02T00:00:00Z' WHERE vendor_id=$1",
      [f.vendor],
    );
    const shared: Intent = {
      ...binding,
      choice: "existing_ticket",
      ticket: {
        type: "canonical",
        kind: "ticket",
        id: initial.ticketId,
        version: 1,
      },
    };
    const second = make();
    await attachFleetBillingV2(context, second, shared, {
      workAt: "2026-10-16T13:00:00Z",
      pricingIntent: {
        mode: "unpriced",
        reason: "offline_reference_missing",
        serviceId: f.service,
        approvalRef: null,
      },
    });
    expect(second.billingV2?.pricing).toMatchObject({
      mode: "priced",
      rateCard: { unitRate: "12" },
    });
    expect(first.billingV2?.pricing).toMatchObject({
      mode: "priced",
      rateCard: { unitRate: "0.0125" },
    });
    expect(second.linkedTicketId).toBe(initial.ticketId);
    await client.query(
      "UPDATE partner_vendor_work_type_approvals SET precise_unit_price=NULL,approved_unit_price=NULL WHERE vendor_id=$1",
      [f.vendor],
    );
    const unresolved = make();
    await attachFleetBillingV2(context, unresolved, shared, {
      workAt: "2026-10-16T14:00:00Z",
      pricingIntent: {
        mode: "unpriced",
        reason: "approval_required",
        serviceId: f.service,
        approvalRef: null,
      },
    });
    expect(unresolved.billingV2?.pricing).toMatchObject({
      mode: "unpriced",
      reason: "approval_required",
    });
    expect(
      (
        await client.query(
          "SELECT id FROM ticket_line_items WHERE ticket_id=$1",
          [initial.ticketId],
        )
      ).rows,
    ).toHaveLength(0);
    await client.query(
      "UPDATE site_locations SET fleet_ticket_policy=$2::jsonb WHERE id=$1",
      [f.site, JSON.stringify({ version: 1, mode: "singles" })],
    );
    await expect(
      attachFleetBillingV2(context, make(), shared, {
        workAt: "2026-10-16T14:00:00Z",
        pricingIntent: {
          mode: "unpriced",
          reason: "approval_required",
          serviceId: f.service,
          approvalRef: null,
        },
      }),
    ).rejects.toMatchObject({ code: "fleet.ticket_batching_forbidden" });
    const single = make();
    await attachFleetBillingV2(context, single, binding, {
      workAt: "2026-10-16T14:00:00Z",
      pricingIntent: {
        mode: "unpriced",
        reason: "approval_required",
        serviceId: f.service,
        approvalRef: null,
      },
    });
    expect(
      (
        await client.query("SELECT fleet_plan FROM tickets WHERE id=$1", [
          single.linkedTicketId,
        ])
      ).rows[0].fleet_plan.batchingAllowed,
    ).toBe(false);
    await client.query(
      "UPDATE site_locations SET fleet_ticket_policy=NULL WHERE id=$1",
      [f.site],
    );
    await client.query(
      "UPDATE site_locations SET fleet_ticket_policy=$2::jsonb WHERE id=$1",
      [f.site, JSON.stringify({ version: 1, mode: "unknown" })],
    );
    await expect(
      attachFleetBillingV2(context, make(), binding, {
        workAt: "2026-10-16T14:00:00Z",
        pricingIntent: {
          mode: "unpriced",
          reason: "approval_required",
          serviceId: f.service,
          approvalRef: null,
        },
      }),
    ).rejects.toMatchObject({ code: "fleet.billing_policy_unavailable" });
    await client.query(
      "UPDATE site_locations SET fleet_ticket_policy=NULL WHERE id=$1",
      [f.site],
    );
    await expect(
      attachFleetBillingV2(
        context,
        make(),
        { ...shared, afeNumber: "OTHER" },
        {
          workAt: "2026-10-16T14:00:00Z",
          pricingIntent: {
            mode: "unpriced",
            reason: "approval_required",
            serviceId: f.service,
            approvalRef: null,
          },
        },
      ),
    ).rejects.toMatchObject({ code: "fleet.billing_afe_mismatch" });
    await client.query("UPDATE tickets SET status='submitted' WHERE id=$1", [
      initial.ticketId,
    ]);
    await expect(
      attachFleetBillingV2(context, make(), shared, {
        workAt: "2026-10-16T14:00:00Z",
        pricingIntent: {
          mode: "unpriced",
          reason: "approval_required",
          serviceId: f.service,
          approvalRef: null,
        },
      }),
    ).rejects.toMatchObject({ code: "fleet.ticket_closed" });
    const originalPlan = FleetTicketPlanSchema.parse({
      version: 2,
      billingWorkflow: true,
      billingUnit: "per_job",
      afeNumber: "AFE1",
      workDate: "2026-10-16",
      siteId: f.site,
      vendorId: f.vendor,
      partnerId: f.partner,
      mode: "batch",
      rateCents: 2500,
      currency: "USD",
      closure: "manual",
      closesAt: null,
      destinations: [],
      createdByUserId: actor.userId,
      createdAt: "2026-10-16T00:00:00Z",
    });
    const legacyTicket = (
      await client.query(
        "INSERT INTO tickets(site_location_id,vendor_id,work_type_id,fleet_plan) VALUES($1,$2,$3,$4::jsonb) RETURNING id",
        [f.site, f.vendor, f.service, JSON.stringify(originalPlan)],
      )
    ).rows[0].id;
    const addedToLegacy = make();
    await attachFleetBillingV2(
      context,
      addedToLegacy,
      {
        ...shared,
        ticket: {
          type: "canonical",
          kind: "ticket",
          id: legacyTicket,
          version: 2,
        },
      },
      {
        workAt: "2026-10-16T14:00:00Z",
        pricingIntent: {
          mode: "unpriced",
          reason: "approval_required",
          serviceId: f.service,
          approvalRef: null,
        },
      },
    );
    const upgraded = (
      await client.query("SELECT fleet_plan FROM tickets WHERE id=$1", [
        legacyTicket,
      ])
    ).rows[0].fleet_plan;
    expect(upgraded).toMatchObject({ billingVersion: 2, revision: 3 });
    expect(upgraded.legacyPlanReference).toMatch(
      /^fleet-legacy-plan:[a-f0-9]{64}$/,
    );
    const retained = (
      await client.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-legacy-plan' AND target_id=$2",
        [f.vendor, upgraded.legacyPlanReference],
      )
    ).rows;
    expect(retained).toHaveLength(1);
    expect(retained[0].tool_output).toMatchObject({
      ticketId: legacyTicket,
      companyId: f.vendor,
      originalPlan,
    });
    const oldRun = make();
    oldRun.linkedTicketId = legacyTicket;
    oldRun.status = "completed";
    oldRun.billing = {
      afeNumber: "AFE1",
      workDate: "2026-10-16",
      unit: "per_job",
      billedLineId: null,
    };
    await recordFleetBillingCharge(client, actor, oldRun);
    expect(
      (
        await client.query(
          "SELECT quantity,unit_price FROM ticket_line_items WHERE id=$1",
          [oldRun.billing.billedLineId],
        )
      ).rows[0],
    ).toEqual({ quantity: "1.00", unit_price: "25.00" });
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-legacy-plan'",
          [f.vendor],
        )
      ).rows[0].count,
    ).toBe(1);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
