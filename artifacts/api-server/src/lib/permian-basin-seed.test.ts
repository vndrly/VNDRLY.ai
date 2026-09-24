// Verifies that the Permian-Basin seed script
// (artifacts/api-server/scripts/seed-permian-basin.ts) is idempotent:
// re-running it against an already-seeded DB inserts zero rows, enriches
// zero rows, and never trips the partners_canonical_name_unique /
// vendors_canonical_name_unique indexes.
//
// Without this guard, a future edit (e.g. adding a new operator without
// going through the canonical lookup, or adding a synonym row that
// collides with an existing canonical name) would silently regress and
// only be noticed the next time someone ran the script by hand.
//
// Skips with a no-op describe when DATABASE_URL is unavailable so CI can
// still run the rest of the unit suite.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIsolatedSchema,
  hasReachableDatabase,
  type IsolatedSchemaHandle,
} from "../test/db-harness";

const haveRealDb = await hasReachableDatabase();

describe.runIf(haveRealDb)("seed-permian-basin idempotency", () => {
  let s: typeof import("@workspace/db");
  let seedPartners: typeof import("../../scripts/seed-permian-basin.js").seedPartners;
  let seedVendors: typeof import("../../scripts/seed-permian-basin.js").seedVendors;
  let handle: IsolatedSchemaHandle | null = null;

  beforeAll(async () => {
    // A before/after ID snapshot cannot establish fixture ownership: another
    // suite can insert a partner during the seed and attach real FK children.
    // Give this seed its own database. Fresh-local teardown retains its rows.
    handle = await createIsolatedSchema("permian_seed");
    handle.activate();
    s = await import("@workspace/db");
    const seed = await import("../../scripts/seed-permian-basin.js");
    seedPartners = seed.seedPartners;
    seedVendors = seed.seedVendors;
  });

  afterAll(async () => {
    try {
      await s?.pool.end();
    } finally {
      await handle?.teardown();
    }
  });

  it("re-running the seed makes no changes (no inserts, no enriches, no errors)", async () => {
    // First run: brings the DB up to the canonical seed state. Whatever
    // it inserts/enriches is fine — we're testing the SECOND run.
    await seedPartners();
    await seedVendors();

    // Second run: this is the actual assertion. With the canonical
    // lookup in place this MUST insert zero rows and enrich zero rows,
    // and MUST NOT throw a unique-violation. If a future edit sneaks in
    // a near-duplicate seed entry (different case / whitespace / a new
    // row with a name that collides with an existing canonical name),
    // this assertion will catch it.
    const partnerCounts = await seedPartners();
    const vendorCounts = await seedVendors();

    expect(partnerCounts.inserted).toBe(0);
    expect(partnerCounts.enriched).toBe(0);
    expect(vendorCounts.inserted).toBe(0);
    expect(vendorCounts.enriched).toBe(0);
  }, 60_000);
});
