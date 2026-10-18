import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  buildSemanticMarketplaceBackfillPlan,
  assertSemanticMarketplaceBackfillApplyGuard,
  reconcileSemanticMarketplaceBackfill,
  runSemanticServiceMarketplaceBackfill,
  type BackfillSnapshot,
} from "../../scripts/backfill-semantic-service-marketplace";

const snapshot = (): BackfillSnapshot => ({
  workTypes: [
    { id: 10, partnerId: 1, sourceWorkTypeId: null, name: "Gatekeeping", category: "Security", description: "Control site entry" },
    { id: 11, partnerId: 2, sourceWorkTypeId: null, name: "Perimeter Security", category: "Security", description: "Control the perimeter" },
    { id: 12, partnerId: 1, sourceWorkTypeId: null, name: "Pressure Test", category: "Testing", description: null },
  ],
  vendorWorkTypes: [
    { id: 20, vendorId: 7, workTypeId: 10, unitPrice: "32.00", unit: "per_hour", currency: "USD", notes: "legacy rate" },
  ],
  canonicalServices: [
    { id: 30, code: "gate-security", name: "Gate & Perimeter Security", category: "Security", definition: "Control access and perimeter security", active: true },
    { id: 31, code: "unrelated-conflict", name: "Pressure Test", category: "Inspection", definition: "A conflicting concept", active: true },
    { id: 32, code: "pressure-testing", name: "Pressure Testing", category: "Testing", definition: "Pressure testing", active: true },
  ],
  aliases: [
    { canonicalServiceId: 30, alias: "Gatekeeping", active: true },
    { canonicalServiceId: 30, alias: "Perimeter Security", active: true },
    { canonicalServiceId: 31, alias: "Pressure Test", active: true },
    { canonicalServiceId: 32, alias: "Pressure Test", active: true },
  ],
  mappings: [], capabilities: [], offers: [],
});

describe.runIf(process.env.VNDRLY_ISOLATED_TEST_DB === "1")("semantic marketplace backfill persisted SQL", () => {
  let client: pg.Client;
  beforeAll(async () => {
    // The repository wrapper creates a brand-new database and stamps this
    // marker. Refuse any unproven/shared target even if DATABASE_URL exists.
    if (process.env.VNDRLY_TEST_DB_MODE !== "fresh-local" || !process.env.VNDRLY_FRESH_TEST_DB_NAME?.match(/^vndrly_[a-f0-9]{32}_test$/u)) {
      throw new Error("Backfill database tests require the fresh-local wrapper");
    }
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => { await client?.end(); });

  it("resumes a partial persisted run, preserves legacy rows, and makes the second apply a no-op", async () => {
    const partner = (await client.query<{ id: number }>(`insert into partners (name,contact_name,contact_email) values ('Backfill Test Partner','Test','backfill-partner@example.invalid') returning id`)).rows[0]!.id;
    const vendor = (await client.query<{ id: number }>(`insert into vendors (name,contact_name,contact_email) values ('Backfill Test Vendor','Test','backfill-vendor@example.invalid') returning id`)).rows[0]!.id;
    const canonical = (await client.query<{ id: number }>(`insert into canonical_services (code,name,category,definition) values ('test-gate-security','Gate Security','Security','Controls access') returning id`)).rows[0]!.id;
    await client.query(`insert into canonical_service_aliases (canonical_service_id,alias,provenance) values ($1,'Gatekeeping','platform')`, [canonical]);
    const workType = (await client.query<{ id: number }>(`insert into work_types (partner_id,name,category,description) values ($1,'Gatekeeping','Security','Controls site entry') returning id`, [partner])).rows[0]!.id;
    const selection = (await client.query<{ id: number }>(`insert into vendor_work_types (vendor_id,work_type_id,unit_price,unit,currency) values ($1,$2,'32.00','per_hour','USD') returning id`, [vendor, workType])).rows[0]!.id;
    // Simulate a prior batch that committed classification but stopped before
    // capability/offer projection.
    await client.query(`insert into service_mappings (subject_type,subject_id,work_type_id,canonical_service_id,status,confidence,explanation,evidence,model_version,mapping_version,actor_process) values ('partner_work_type',$1,$1,$2,'active','1','prior verified batch','{}','deterministic-exact-v1',1,'semantic-service-marketplace-backfill:v1')`, [workType, canonical]);
    const legacyBefore = (await client.query(`select w.id, v.id vendor_work_type_id from work_types w join vendor_work_types v on v.work_type_id=w.id where w.id=$1`, [workType])).rows;

    const first = await runSemanticServiceMarketplaceBackfill(client, { dryRun: false, activationThreshold: 0.98, maxConflictRate: 1, batchSize: 1 });
    expect(first.dryRun).toBe(false);
    const persisted = await client.query(`select c.id capability_id, c.evidence, o.source_vendor_work_type_id, o.work_type_id from vendor_capabilities c join vendor_partner_service_offers o on o.vendor_capability_id=c.id where c.vendor_id=$1`, [vendor]);
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({ source_vendor_work_type_id: selection, work_type_id: workType });
    expect(persisted.rows[0].evidence.semanticMarketplaceBackfill).toMatchObject({ sourceVendorWorkTypeId: selection, canonicalServiceId: canonical });

    const second = await runSemanticServiceMarketplaceBackfill(client, { dryRun: false, activationThreshold: 0.98, maxConflictRate: 1, batchSize: 1 });
    expect(second.dryRun).toBe(false);
    expect(second.report).toMatchObject({ insertedMappings: 0, insertedCapabilities: 0, insertedOffers: 0 });
    expect((await client.query(`select w.id, v.id vendor_work_type_id from work_types w join vendor_work_types v on v.work_type_id=w.id where w.id=$1`, [workType])).rows).toEqual(legacyBefore);
  });
});

describe("semantic marketplace legacy backfill", () => {
  it("requires an explicit apply token for writes but not dry runs", () => {
    expect(() => assertSemanticMarketplaceBackfillApplyGuard(false, {})).toThrow("APPLY_SEMANTIC_SERVICE_MARKETPLACE_BACKFILL=1");
    expect(() => assertSemanticMarketplaceBackfillApplyGuard(false, { APPLY_SEMANTIC_SERVICE_MARKETPLACE_BACKFILL: "0" })).toThrow();
    expect(() => assertSemanticMarketplaceBackfillApplyGuard(true, {})).not.toThrow();
    expect(() => assertSemanticMarketplaceBackfillApplyGuard(false, { APPLY_SEMANTIC_SERVICE_MARKETPLACE_BACKFILL: "1" })).not.toThrow();
  });
  it("projects unique exact aliases with durable source lineage without changing legacy identifiers", () => {
    const before = snapshot();
    const plan = buildSemanticMarketplaceBackfillPlan(before, { activationThreshold: 0.98 });

    expect(plan.mappings.filter((row) => row.status === "active").map((row) => [row.workTypeId, row.canonicalServiceId])).toEqual([
      [10, 30], [11, 30],
    ]);
    expect(plan.capabilities).toEqual([
      expect.objectContaining({ vendorId: 7, canonicalServiceId: 30, sourceVendorWorkTypeId: 20 }),
    ]);
    expect(plan.offers).toEqual([
      expect.objectContaining({ partnerId: 1, workTypeId: 10, sourceVendorWorkTypeId: 20, unitPrice: "32.00" }),
    ]);
    expect(before.workTypes.map((row) => row.id)).toEqual([10, 11, 12]);
    expect(before.vendorWorkTypes.map((row) => row.id)).toEqual([20]);
  });

  it("stops ambiguous aliases for review instead of guessing or projecting prices", () => {
    const plan = buildSemanticMarketplaceBackfillPlan(snapshot(), { activationThreshold: 0.98 });
    expect(plan.mappings).toContainEqual(expect.objectContaining({ workTypeId: 12, canonicalServiceId: null, status: "review_required" }));
    expect(plan.conflicts).toEqual([expect.objectContaining({ workTypeId: 12, candidateCanonicalServiceIds: [31, 32] })]);
    expect(plan.capabilities.some((row) => row.canonicalServiceId === 31 || row.canonicalServiceId === 32)).toBe(false);
  });

  it("keeps novel unmatched services pending for admin review", () => {
    const input = snapshot();
    input.workTypes = [{ id: 99, partnerId: 1, sourceWorkTypeId: null, name: "Novel Service", category: "Other", description: "Not in the reviewed vocabulary" }];
    input.vendorWorkTypes = [{ id: 98, vendorId: 7, workTypeId: 99, unitPrice: "10.00", unit: "per_hour", currency: "USD", notes: null }];

    const plan = buildSemanticMarketplaceBackfillPlan(input, { activationThreshold: 0.98 });
    expect(plan.canonicalServices).toEqual([]);
    expect(plan.mappings).toEqual([expect.objectContaining({ workTypeId: 99, canonicalServiceId: null, status: "review_required" })]);
    expect(plan.capabilities).toEqual([]);
    expect(plan.offers).toEqual([]);
  });

  it("blocks offers when prior capability lineage points at a superseded canonical service", () => {
    const input = snapshot();
    input.capabilities = [{ id: 50, vendorId: 7, canonicalServiceId: 31, sourceVendorWorkTypeId: 20 }];

    const plan = buildSemanticMarketplaceBackfillPlan(input, { activationThreshold: 0.98 });
    expect(plan.capabilities).toEqual([]);
    expect(plan.offers).toEqual([]);
    expect(plan.conflicts).toContainEqual(expect.objectContaining({ workTypeId: 10, reason: "capability_canonical_mismatch" }));
  });

  it("is a no-op after a partial prior run and never recreates removed historical selections", () => {
    const prior = snapshot();
    prior.mappings.push({ id: 40, workTypeId: 10, canonicalServiceId: 30, status: "active", actorProcess: "semantic-service-marketplace-backfill:v1" });
    prior.capabilities.push({ id: 50, vendorId: 7, canonicalServiceId: 30, sourceVendorWorkTypeId: 20 });
    prior.offers.push({ id: 60, vendorCapabilityId: 50, partnerId: 1, workTypeId: 10, sourceVendorWorkTypeId: 20 });
    // This old snapshot entry is intentionally absent from current vendorWorkTypes.
    prior.historicalVendorSelections = [{ vendorId: 7, workTypeId: 11 }];

    const plan = buildSemanticMarketplaceBackfillPlan(prior, { activationThreshold: 0.98 });
    expect(plan.mappings.some((row) => row.workTypeId === 10)).toBe(false);
    expect(plan.capabilities).toEqual([]);
    expect(plan.offers).toEqual([]);
  });

  it("reconciles before/after counts and rejects missing lineage", () => {
    const before = snapshot();
    const plan = buildSemanticMarketplaceBackfillPlan(before, { activationThreshold: 0.98 });
    const report = reconcileSemanticMarketplaceBackfill(before, plan, {
      workTypeCount: 3, vendorWorkTypeCount: 1, ticketCount: 9,
      insertedMappings: 3, insertedCapabilities: 1, insertedOffers: 1,
      afterWorkTypeCount: 3, afterVendorWorkTypeCount: 1, afterTicketCount: 9,
    });
    expect(report.preserved).toEqual({ workTypes: true, vendorWorkTypes: true, tickets: true });
    expect(report.lineageComplete).toBe(true);
    expect(report.conflictCount).toBe(1);

    expect(() => reconcileSemanticMarketplaceBackfill(before, { ...plan, offers: [{ ...plan.offers[0]!, sourceVendorWorkTypeId: null as never }] }, {
      workTypeCount: 3, vendorWorkTypeCount: 1, ticketCount: 9,
      insertedMappings: 3, insertedCapabilities: 1, insertedOffers: 1,
      afterWorkTypeCount: 3, afterVendorWorkTypeCount: 1, afterTicketCount: 9,
    })).toThrow("lineage");
  });
});
