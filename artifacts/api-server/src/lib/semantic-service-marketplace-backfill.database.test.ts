import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { subjectFingerprint } from "../services/service-matching/candidates";
import { createPostgresPartnerMarketplaceStore, discoverPartnerMarketplaceVendors } from "../services/marketplace/partner-store";
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

  it("makes newly backfilled saved demand discoverable with its persisted capability mapping", async () => {
    const partner = (await client.query<{ id: number }>(`insert into partners (name,contact_name,contact_email) values ('Fingerprint Partner','Test','fingerprint-partner@example.invalid') returning id`)).rows[0].id;
    const vendor = (await client.query<{ id: number }>(`insert into vendors (name,contact_name,contact_email,federal_tax_id,coi_document_url,insurance_expiration_date,w9_document_url,wc_document_url,wc_expiration_date,gl_document_url,gl_expiration_date,auto_liability_document_url,auto_liability_expiration_date) values ('Fingerprint Vendor','Test','fingerprint-vendor@example.invalid','00-0000000','test','2099-01-01','test','test','2099-01-01','test','2099-01-01','test','2099-01-01') returning id`)).rows[0].id;
    await client.query(`insert into canonical_services (code,name,category,definition) values ('backfill-fingerprint','Backfill fingerprint scope','Testing','Fingerprint scope')`);
    const work = (await client.query<{ id: number }>(`insert into work_types (partner_id,name,category,description) values ($1,'Backfill fingerprint scope','Testing','Exact persisted punctuation: A/B') returning id`, [partner])).rows[0].id;
    await client.query(`insert into vendor_work_types (vendor_id,work_type_id,unit_price,unit,currency) values ($1,$2,'32.00','per_hour','USD')`, [vendor, work]);
    const site = (await client.query<{ id: number }>(`insert into site_locations (partner_id,name,address,latitude,longitude,site_code) values ($1,'Fingerprint site','Test site',35,-97,'BACKFILL-FINGERPRINT') returning id`, [partner])).rows[0].id;
    await client.query(`insert into vendor_service_areas (vendor_id,address,latitude,longitude,radius_miles,coordinate_provenance,verified_at,effective_from) values ($1,'Test base',35,-97,50,'test','2026-01-01','2026-01-01')`, [vendor]);
    await runSemanticServiceMarketplaceBackfill(client, { dryRun: false, activationThreshold: .98, maxConflictRate: 1, batchSize: 1 });
    const store = createPostgresPartnerMarketplaceStore();
    const context = await store.loadContext(partner, work, site);
    expect(context).not.toBeNull();
    const results = await discoverPartnerMarketplaceVendors(store, context!, { requestedCapacity: 1 }, new Date("2026-12-01"));
    expect(results).toEqual([expect.objectContaining({ vendorId: vendor, offerable: true })]);
  });
  it("resumes a partial persisted run, preserves legacy rows, and makes the second apply a no-op", async () => {
    const partner = (await client.query<{ id: number }>(`insert into partners (name,contact_name,contact_email) values ('Backfill Test Partner','Test','backfill-partner@example.invalid') returning id`)).rows[0]!.id;
    const vendor = (await client.query<{ id: number }>(`insert into vendors (name,contact_name,contact_email) values ('Backfill Test Vendor','Test','backfill-vendor@example.invalid') returning id`)).rows[0]!.id;
    const canonical = (await client.query<{ id: number }>(`insert into canonical_services (code,name,category,definition) values ('test-gate-security','Gate Security','Security','Controls access') returning id`)).rows[0]!.id;
    await client.query(`insert into canonical_service_aliases (canonical_service_id,alias,provenance) values ($1,'Gatekeeping','platform')`, [canonical]);
    const workType = (await client.query<{ id: number }>(`insert into work_types (partner_id,name,category,description) values ($1,'Gatekeeping','Security','Controls site entry') returning id`, [partner])).rows[0]!.id;
    const selection = (await client.query<{ id: number }>(`insert into vendor_work_types (vendor_id,work_type_id,unit_price,unit,currency) values ($1,$2,'32.00','per_hour','USD') returning id`, [vendor, workType])).rows[0]!.id;
    // Simulate a prior batch that committed classification but stopped before
    // capability/offer projection.
    const evidence = { serviceMatching: { subjectFingerprint: subjectFingerprint({ subjectType: "partner_work_type", subjectId: workType, name: "Gatekeeping", category: "Security", description: "Controls site entry" }) } };
    await client.query(`insert into service_mappings (subject_type,subject_id,work_type_id,canonical_service_id,status,confidence,explanation,evidence,model_version,mapping_version,actor_process) values ('partner_work_type',$1,$1,$2,'active','1','prior verified batch',$3::jsonb,'deterministic-exact-v1',1,'semantic-service-marketplace-backfill:v1')`, [workType, canonical, JSON.stringify(evidence)]);
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

    // Canonical legacy self-service/admin/import/onboarding paths remove or
    // replace vendor_work_types. Marketplace history must survive both actions.
    expect((await client.query(`select c.conname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey) where c.conrelid='vendor_partner_service_offers'::regclass and c.contype='f' and a.attname='source_vendor_work_type_id'`)).rows).toEqual([]);
    await client.query(`delete from vendor_work_types where id=$1`, [selection]);
    expect((await client.query(`select source_vendor_work_type_id from vendor_partner_service_offers where vendor_capability_id=$1`, [persisted.rows[0].capability_id])).rows).toEqual([{ source_vendor_work_type_id: selection }]);
    const replacement = (await client.query<{ id: number }>(`insert into vendor_work_types (vendor_id,work_type_id,unit_price,unit,currency) values ($1,$2,'99.00','per_hour','USD') returning id`, [vendor, workType])).rows[0]!.id;
    expect(replacement).not.toBe(selection);
    const afterReplacement = (await client.query(`select c.evidence, o.source_vendor_work_type_id, o.unit_price from vendor_capabilities c join vendor_partner_service_offers o on o.vendor_capability_id=c.id where c.id=$1`, [persisted.rows[0].capability_id])).rows[0];
    expect(afterReplacement).toMatchObject({ source_vendor_work_type_id: selection, unit_price: "32.00" });
    expect(afterReplacement.evidence.semanticMarketplaceBackfill.sourceVendorWorkTypeId).toBe(selection);
  });

  it("honors a committed reviewer rejection between planning and the subject lock", async () => {
    const workType = (await client.query<{ id: number }>(`insert into work_types (name,category) values ('Backfill fingerprint scope','Testing') returning id`)).rows[0]!.id;
    const reviewer = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await reviewer.connect();
    let reviewed = false;
    const intercepted = { query: async (text: string, values?: unknown[]) => {
      if (!reviewed && text.includes("pg_advisory_xact_lock(hashtextextended") && values?.[0] === `service-mapping:partner_work_type:${workType}`) {
        reviewed = true;
        await reviewer.query("begin");
        await reviewer.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, values);
        await reviewer.query(`insert into service_mappings (subject_type,subject_id,work_type_id,status,confidence,explanation,evidence,model_version,mapping_version,actor_process,reviewed_at) values ('partner_work_type',$1,$1,'rejected','0','Human rejected','{}','human',1,'admin-service-review',now())`, [workType]);
        await reviewer.query("commit");
      }
      return client.query(text, values);
    } };
    try {
      await expect(runSemanticServiceMarketplaceBackfill(intercepted as never, { dryRun: false, activationThreshold: .98, maxConflictRate: 1, batchSize: 1 })).rejects.toThrow("decision changed");
      expect(reviewed).toBe(true);
      expect((await client.query(`select status,actor_process from service_mappings where work_type_id=$1`, [workType])).rows).toEqual([{ status: "rejected", actor_process: "admin-service-review" }]);
      const rerun = await runSemanticServiceMarketplaceBackfill(client, { dryRun: true, activationThreshold: .98, maxConflictRate: 1, batchSize: 1 });
      expect(rerun.plan.mappings.some(row => row.workTypeId === workType)).toBe(false);
    } finally { await reviewer.end(); }
  });
});

describe("semantic marketplace legacy backfill", () => {
  it.each(["mappingVersion", "subjectFingerprint", "status"])("rechecks %s before projecting an already mapped capability", async field => {
    const input = snapshot();
    const work = input.workTypes[0]!;
    input.workTypes = [work];
    const prior = { id: 40, workTypeId: 10, canonicalServiceId: 30, status: "active", actorProcess: "admin-service-review", mappingVersion: 1,
      subjectFingerprint: subjectFingerprint({ ...work, subjectType: "partner_work_type" as const, subjectId: work.id }) };
    input.mappings = [prior];
    expect(buildSemanticMarketplaceBackfillPlan(input, { activationThreshold: .98 }).capabilities).toHaveLength(1);
    let writes = 0;
    const client = { query: async (text: string) => {
      let rows: unknown[] = [];
      if (text.includes("pg_try_advisory_lock")) rows = [{ locked: true }];
      else if (text.includes("count(*)")) rows = [{ work_types: "1", vendor_work_types: "1", tickets: "0" }];
      else if (text.includes("from work_types")) rows = input.workTypes;
      else if (text.includes("from vendor_work_types")) rows = input.vendorWorkTypes;
      else if (text.includes("from canonical_services")) rows = input.canonicalServices;
      else if (text.includes("from canonical_service_aliases")) rows = input.aliases;
      else if (text.includes("from service_mappings")) rows = text.includes("subject_id=$1") ? [{ ...prior, [field]: field === "mappingVersion" ? 2 : field === "status" ? "rejected" : "changed" }] : input.mappings;
      if (text.startsWith("insert")) writes++;
      return { rows, rowCount: rows.length };
    } };
    await expect(runSemanticServiceMarketplaceBackfill(client as never, { dryRun: false, activationThreshold: .98, maxConflictRate: 1, batchSize: 1 })).rejects.toThrow("decision changed");
    expect(writes).toBe(0);
  });
  it("does not project a legacy selection removed after planning", async () => {
    const input = snapshot();
    const work = input.workTypes[0]!;
    input.workTypes = [work];
    input.mappings = [{ id: 40, workTypeId: 10, canonicalServiceId: 30, status: "active", actorProcess: "admin-service-review", mappingVersion: 1,
      subjectFingerprint: subjectFingerprint({ ...work, subjectType: "partner_work_type", subjectId: work.id }) }];
    let insertedCapabilities = 0;
    const client = { query: async (text: string) => {
      let rows: unknown[] = [];
      if (text.includes("pg_try_advisory_lock")) rows = [{ locked: true }];
      else if (text.includes("count(*)")) rows = [{ work_types: "1", vendor_work_types: "1", tickets: "0" }];
      else if (text.includes("from work_types")) rows = input.workTypes;
      else if (text.startsWith("select") && text.includes("from vendor_work_types")) rows = text.includes("where id=") ? [] : input.vendorWorkTypes;
      else if (text.includes("from canonical_services")) rows = input.canonicalServices;
      else if (text.includes("from canonical_service_aliases")) rows = input.aliases;
      else if (text.startsWith("select") && text.includes("from service_mappings")) rows = input.mappings;
      else if (text.startsWith("insert into vendor_capabilities")) { insertedCapabilities++; rows = [{ id: 50 }]; }
      else if (text.startsWith("select") && text.includes("from vendor_capabilities") && text.includes("where id=")) rows = [{ name: work.name, description: work.description, active: true }];
      else if (text.startsWith("select") && text.includes("from vendor_capabilities") && text.includes("vendor_id=$1")) rows = [{ id: 50 }];
      return { rows, rowCount: text.startsWith("insert") ? 1 : rows.length };
    } };
    await expect(runSemanticServiceMarketplaceBackfill(client as never, { dryRun: false, activationThreshold: .98, maxConflictRate: 1, batchSize: 1 })).rejects.toThrow("selection changed");
    expect(insertedCapabilities).toBe(0);
  });
  it("does not project an active mapping for stale or missing subject evidence", () => {
    for (const fingerprint of [null, "outdated"]) {
      const input = snapshot();
      input.mappings = [{ id: 40, workTypeId: 10, canonicalServiceId: 30, status: "active", actorProcess: "admin-service-review", subjectFingerprint: fingerprint }];
      const plan = buildSemanticMarketplaceBackfillPlan(input, { activationThreshold: .98 });
      expect(plan.capabilities).toEqual([]);
      expect(plan.offers).toEqual([]);
    }
  });
  it.each(["rejected", "review_required"])("preserves a human %s decision despite an exact alias", (status) => {
    const input = snapshot();
    input.mappings = [{ id: 40, workTypeId: 10, canonicalServiceId: 30, status, actorProcess: "admin-service-review" }];
    const plan = buildSemanticMarketplaceBackfillPlan(input, { activationThreshold: .98 });
    expect(plan.mappings.filter(row => row.workTypeId === 10)).toEqual([]);
    expect(plan.capabilities).toEqual([]);
    expect(plan.offers).toEqual([]);
  });

  it("aborts when human review changes the decision after planning and before the apply lock", async () => {
    const input = snapshot();
    input.workTypes = [input.workTypes[0]!];
    input.vendorWorkTypes = [];
    let inserted = 0;
    const client = { query: async (text: string) => {
      let rows: unknown[] = [];
      if (text.includes("pg_try_advisory_lock")) rows = [{ locked: true }];
      else if (text.includes("count(*)")) rows = [{ work_types: "1", vendor_work_types: "0", tickets: "0" }];
      else if (text.includes("from work_types")) rows = input.workTypes;
      else if (text.includes("from canonical_services")) rows = input.canonicalServices;
      else if (text.includes("from canonical_service_aliases")) rows = input.aliases;
      else if (text.includes("from service_mappings") && !text.startsWith("insert") && text.includes("subject_id"))
        rows = [{ id: 41, workTypeId: 10, canonicalServiceId: 30, status: "rejected", actorProcess: "admin-service-review", mappingVersion: 2 }];
      if (text.startsWith("insert into service_mappings")) inserted++;
      return { rows, rowCount: text.startsWith("insert") ? 1 : rows.length };
    } };
    await expect(runSemanticServiceMarketplaceBackfill(client as never, { dryRun: false, activationThreshold: .98, maxConflictRate: 1, batchSize: 1 })).rejects.toThrow("decision changed");
    expect(inserted).toBe(0);
  });
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
    prior.mappings.push({ id: 40, workTypeId: 10, canonicalServiceId: 30, status: "active", actorProcess: "semantic-service-marketplace-backfill:v1", subjectFingerprint: subjectFingerprint({ ...prior.workTypes[0]!, subjectType: "partner_work_type", subjectId: 10 }) });
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
