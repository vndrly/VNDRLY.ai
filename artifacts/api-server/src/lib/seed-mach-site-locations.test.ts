// Verify idempotency in a dedicated fresh-local database; never infer fixture
// ownership from a before/after snapshot of shared tables.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedSchema, hasReachableDatabase, type IsolatedSchemaHandle } from "../test/db-harness";

const haveRealDb = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && await hasReachableDatabase();
describe.runIf(haveRealDb)("seed-mach-site-locations idempotency", () => {
  let s: typeof import("@workspace/db");
  let seedMachSiteLocations: typeof import("../../scripts/seed-mach-site-locations.js").seedMachSiteLocations;
  let seedPartners: typeof import("../../scripts/seed-permian-basin.js").seedPartners;
  let handle: IsolatedSchemaHandle | null = null;
  beforeAll(async () => {
    handle = await createIsolatedSchema("mach_seed");
    handle.activate();
    s = await import("@workspace/db");
    seedMachSiteLocations = (await import("../../scripts/seed-mach-site-locations.js")).seedMachSiteLocations;
    seedPartners = (await import("../../scripts/seed-permian-basin.js")).seedPartners;
  });
  afterAll(async () => {
    try { await s?.pool.end(); } finally { await handle?.teardown(); }
  });
  it("re-running the seed makes no changes (no inserts, no errors)", async () => {
    await seedPartners();
    const firstRun = await seedMachSiteLocations();
    expect(firstRun.partnerMissing).toBe(false);
    expect(firstRun.inserted).toBeGreaterThan(0);
    const secondRun = await seedMachSiteLocations();
    expect(secondRun.inserted).toBe(0);
    expect(secondRun.partnerMissing).toBe(false);
    expect(secondRun.skipped).toBe(firstRun.inserted);
  }, 60_000);
});
