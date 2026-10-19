// Verifies that the Permian / Mid-Continent site-locations seed script
// (artifacts/api-server/scripts/seed-permian-site-locations.ts) is
// idempotent: re-running it against an already-seeded DB inserts zero
// rows and never throws. Mirrors the pattern in
// permian-basin-seed.test.ts.
//
// Without this guard, a future edit (e.g. renaming an operator's site
// pattern, or removing the (partnerId, name) existing-row check) would
// silently regress and double-insert the next time someone ran the
// script by hand.
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

describe.runIf(haveRealDb)("seed-permian-site-locations idempotency", () => {
  let s: typeof import("@workspace/db");
  let seedAllPermianSiteLocations: typeof import("../../scripts/seed-permian-site-locations.js").seedAllPermianSiteLocations;
  let seedPartners: typeof import("../../scripts/seed-permian-basin.js").seedPartners;

  let handle: IsolatedSchemaHandle | null = null;

  beforeAll(async () => {
    // ID snapshots cannot establish ownership when other suites share a DB.
    // Isolate both seeds before importing their database connection.
    handle = await createIsolatedSchema("permian_sites_seed");
    handle.activate();
    s = await import("@workspace/db");
    const sites = await import(
      "../../scripts/seed-permian-site-locations.js"
    );
    seedAllPermianSiteLocations = sites.seedAllPermianSiteLocations;
    const permianSeed = await import("../../scripts/seed-permian-basin.js");
    seedPartners = permianSeed.seedPartners;
  });

  afterAll(async () => {
    try {
      await s?.pool.end();
    } finally {
      await handle?.teardown();
    }
  });

  it("re-running the seed makes no changes (no inserts, no errors)", async () => {
    // The site-locations script requires the operator partner rows to
    // already exist (it warns and skips for any missing partner). Run
    // the prerequisite partner seed once in this test's isolated DB.
    await seedPartners();

    // First run: brings the DB up to the canonical seed state. Whatever
    // it inserts is fine — we're testing the SECOND run.
    await seedAllPermianSiteLocations();

    // Second run: this is the actual assertion. With the (partnerId, name)
    // existing-row check in place this MUST insert zero rows and MUST NOT
    // throw. If a future edit sneaks in a near-duplicate site name
    // (e.g. switching a county dash style or whitespace), this assertion
    // will catch it.
    const secondRun = await seedAllPermianSiteLocations();
    expect(secondRun.inserted).toBe(0);
    // After a fresh partner seed, every operator the script knows about
    // must be present — otherwise the second-run "0 inserts" assertion
    // could mask a missing partner row that the script silently skipped.
    expect(secondRun.missingPartners).toEqual([]);
  }, 120_000);
});
