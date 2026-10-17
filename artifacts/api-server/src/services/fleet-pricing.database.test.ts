import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@workspace/db";
import { createFleetPricingFixture } from "../test-utils/fleet-pricing";
import { resolveFleetRateAuthority } from "./fleet-rate-authority";

it("reads the actual retained activity rate under current authority without repricing from a later approval", async () => {
  const module = await import("./fleet-rate-authority");
  expect(module.readRetainedFleetRateAuthority).toBeTypeOf("function");
  const f = await createFleetPricingFixture(),
    actor = { companyId: f.vendor };
  const input = {
    billingContext: {
      partnerId: f.partner,
      billingSiteId: f.site,
      afeNumber: "AFE1",
      workDate: "2026-10-16",
      currency: "USD" as const,
    },
    serviceId: f.service,
    workAt: "2026-10-16T12:00:00Z",
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await resolveFleetRateAuthority(client, actor, {
      ...input,
      approvalRef: null,
      purpose: "capture",
    });
    if (selected.mode !== "priced")
      throw Error("Expected actual approved price");
    await client.query(
      "UPDATE partner_vendor_work_type_approvals SET precise_unit_price='12',approved_at='2026-10-02T00:00:00Z' WHERE vendor_id=$1 AND work_type_id=$2",
      [f.vendor, f.service],
    );
    expect(
      await resolveFleetRateAuthority(client, actor, {
        ...input,
        approvalRef: null,
        purpose: "capture",
      }),
    ).toMatchObject({ mode: "priced", rateCard: { unitRate: "12" } });
    expect(
      await module.readRetainedFleetRateAuthority(client, actor, {
        ...input,
        pricing: selected,
      }),
    ).toEqual(selected);
    await expect(
      module.readRetainedFleetRateAuthority(client, actor, {
        ...input,
        pricing: {
          ...selected,
          rateCard: { ...selected.rateCard, unitRate: "999" },
        },
      }),
    ).rejects.toMatchObject({
      code: "fleet.price_authority_unresolved",
      status: 409,
    });
    await client.query("SAVEPOINT authority_check");
    await client.query(
      "UPDATE partner_vendor_relationships SET status='pending_review' WHERE vendor_id=$1 AND partner_id=$2",
      [f.vendor, f.partner],
    );
    await expect(
      module.readRetainedFleetRateAuthority(client, actor, {
        ...input,
        pricing: selected,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await client.query("ROLLBACK TO SAVEPOINT authority_check");
    const original = (
      await client.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-rate-authority' AND tool_output->'pricing'=$2::jsonb LIMIT 1",
        [f.vendor, JSON.stringify(selected)],
      )
    ).rows[0].tool_output;
    await client.query(
      "INSERT INTO assistant_action_audit(vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,'fleet','derived','canonical','synthetic_integrity','rate-authority-snapshot','fleet-rate-authority',$2,$3::jsonb,'completed')",
      [f.vendor, `fleet-rate:${"0".repeat(64)}`, JSON.stringify(original)],
    );
    await expect(
      module.readRetainedFleetRateAuthority(client, actor, {
        ...input,
        pricing: selected,
      }),
    ).rejects.toMatchObject({
      code: "fleet.price_authority_unavailable",
      status: 503,
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

it("resolves the actual approved precise price, pins immutable readback, and never borrows the live vendor price", async () => {
  const { vendor, partner, user, site, service } =
    await createFleetPricingFixture();
  const actor = { companyId: vendor },
    input = {
      billingContext: {
        partnerId: partner,
        billingSiteId: site,
        afeNumber: "AFE1",
        workDate: "2026-10-16",
        currency: "USD" as const,
      },
      serviceId: service,
      workAt: "2026-10-16T12:00:00Z",
      approvalRef: null,
      purpose: "capture" as const,
    };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await resolveFleetRateAuthority(client, actor, input);
    expect(selected).toMatchObject({
      mode: "priced",
      rateCard: {
        vendorId: vendor,
        partnerId: partner,
        billingSiteId: site,
        serviceId: service,
        basis: "per_barrel",
        unitRate: "0.0125",
        approvedByUserId: user,
        approvalRef: { type: "partner_approval" },
      },
    });
    await client.query(
      "UPDATE vendor_work_types SET precise_unit_price='0.03',unit_price='0.03' WHERE vendor_id=$1 AND work_type_id=$2",
      [vendor, service],
    );
    expect(await resolveFleetRateAuthority(client, actor, input)).toEqual(
      selected,
    );
    const proofs = (
      await client.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-rate-authority'",
        [vendor],
      )
    ).rows;
    expect(proofs).toHaveLength(1);
    expect(proofs[0].tool_output).toMatchObject({ pricing: selected });
    const otherSite = (
      await client.query(
        "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code,afe) VALUES($1,'Other synthetic','Synthetic',35,-97,$2,'AFE1') RETURNING id",
        [partner, randomUUID()],
      )
    ).rows[0].id;
    await client.query(
      "INSERT INTO site_work_assignments(vendor_id,work_type_id,site_location_id,afe) VALUES($1,$2,$3,'AFE1')",
      [vendor, service, otherSite],
    );
    const other = await resolveFleetRateAuthority(client, actor, {
      ...input,
      billingContext: { ...input.billingContext, billingSiteId: otherSite },
    });
    if (selected.mode !== "priced" || other.mode !== "priced")
      throw Error("Expected two actual authorized saved prices");
    expect(other.rateCard.id).not.toBe(selected.rateCard.id);
    await client.query(
      "UPDATE partner_vendor_work_type_approvals SET fleet_rate_card=$2::jsonb WHERE vendor_id=$1",
      [vendor, JSON.stringify({ ...selected.rateCard, unitRate: "0.03" })],
    );
    expect(await resolveFleetRateAuthority(client, actor, input)).toMatchObject(
      { mode: "unpriced", reason: "approval_required" },
    );
    await client.query(
      "UPDATE partner_vendor_work_type_approvals SET fleet_rate_card=NULL WHERE vendor_id=$1",
      [vendor],
    );
    const laterApproval = "2026-10-17T00:00:00.000Z",
      retroactive = {
        ...selected.rateCard,
        approvedAt: laterApproval,
        approvalRef: {
          ...selected.rateCard.approvalRef,
          revision: laterApproval,
        },
      };
    await client.query(
      "UPDATE partner_vendor_work_type_approvals SET approved_at=$2,fleet_rate_card=$3::jsonb WHERE vendor_id=$1",
      [vendor, laterApproval, JSON.stringify(retroactive)],
    );
    expect(await resolveFleetRateAuthority(client, actor, input)).toMatchObject(
      {
        mode: "priced",
        rateCard: {
          approvedAt: laterApproval,
          effectiveFrom: "2026-10-01T00:00:00.000Z",
        },
      },
    );
    const futureApproval = "2099-01-01T00:00:00.000Z";
    await client.query(
      "UPDATE partner_vendor_work_type_approvals SET approved_at=$2,fleet_rate_card=$3::jsonb WHERE vendor_id=$1",
      [
        vendor,
        futureApproval,
        JSON.stringify({
          ...retroactive,
          approvedAt: futureApproval,
          approvalRef: { ...retroactive.approvalRef, revision: futureApproval },
        }),
      ],
    );
    expect(await resolveFleetRateAuthority(client, actor, input)).toMatchObject(
      { mode: "unpriced" },
    );
    await client.query(
      "UPDATE partner_vendor_work_type_approvals SET approved_at='2026-10-01T00:00:00Z',fleet_rate_card=NULL WHERE vendor_id=$1",
      [vendor],
    );
    await expect(
      resolveFleetRateAuthority(client, actor, {
        ...input,
        billingContext: { ...input.billingContext, afeNumber: "OTHER" },
      }),
    ).rejects.toMatchObject({ code: "fleet.billing_afe_mismatch" });
    const stale = await resolveFleetRateAuthority(client, actor, {
      ...input,
      approvalRef: { type: "partner_approval", id: "unknown", revision: "old" },
    });
    expect(stale).toMatchObject({
      mode: "unpriced",
      reason: "agreement_unresolved",
    });
    await client.query(
      "UPDATE partner_vendor_work_type_approvals SET precise_unit_price=NULL,approved_unit_price=NULL WHERE vendor_id=$1",
      [vendor],
    );
    expect(await resolveFleetRateAuthority(client, actor, input)).toMatchObject(
      { mode: "unpriced", reason: "approval_required" },
    );
    await client.query(
      "UPDATE partner_vendor_relationships SET status='pending' WHERE vendor_id=$1 AND partner_id=$2",
      [vendor, partner],
    );
    await expect(
      resolveFleetRateAuthority(client, actor, input),
    ).rejects.toMatchObject({ status: 403 });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
