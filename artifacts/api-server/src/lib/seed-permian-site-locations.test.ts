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
import pg from "pg";
import { inArray } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkRealDb();

async function checkRealDb(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  if (DATABASE_URL.includes("test:test@localhost")) return false;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return false;
  }
}

describe.runIf(haveRealDb)("seed-permian-site-locations idempotency", () => {
  let db: typeof import("@workspace/db").db;
  let s: typeof import("@workspace/db");
  let seedAllPermianSiteLocations: typeof import("../../scripts/seed-permian-site-locations.js").seedAllPermianSiteLocations;
  let seedPartners: typeof import("../../scripts/seed-permian-basin.js").seedPartners;

  // IDs the test inserted (rows that did not exist before the test ran).
  // Used by the cleanup hook so we never delete rows the dev DB had
  // before we touched it.
  const newSiteIds: number[] = [];
  const newPartnerIds: number[] = [];

  beforeAll(async () => {
    s = await import("@workspace/db");
    db = s.db;
    const sites = await import(
      "../../scripts/seed-permian-site-locations.js"
    );
    seedAllPermianSiteLocations = sites.seedAllPermianSiteLocations;
    const permianSeed = await import("../../scripts/seed-permian-basin.js");
    seedPartners = permianSeed.seedPartners;
  });

  afterAll(async () => {
    if (newSiteIds.length > 0) {
      await db
        .delete(s.siteLocationsTable)
        .where(inArray(s.siteLocationsTable.id, newSiteIds));
    }
    if (newPartnerIds.length > 0) {
      await db
        .delete(s.partnersTable)
        .where(inArray(s.partnersTable.id, newPartnerIds));
    }
  });

  it("re-running the seed makes no changes (no inserts, no errors)", async () => {
    // The site-locations script requires the operator partner rows to
    // already exist (it warns and skips for any missing partner). Run
    // the prerequisite partner seed once so this test works on a fresh
    // DB; cleanup below removes anything new it added.
    const partnersBefore = new Set(
      (
        await db.select({ id: s.partnersTable.id }).from(s.partnersTable)
      ).map((r) => r.id),
    );

    await seedPartners();

    const partnersAfter = await db
      .select({ id: s.partnersTable.id })
      .from(s.partnersTable);
    for (const r of partnersAfter) {
      if (!partnersBefore.has(r.id)) newPartnerIds.push(r.id);
    }

    // Snapshot site IDs so we can identify what the seed inserts and
    // delete only those rows in cleanup.
    const sitesBefore = new Set(
      (
        await db
          .select({ id: s.siteLocationsTable.id })
          .from(s.siteLocationsTable)
      ).map((r) => r.id),
    );

    // First run: brings the DB up to the canonical seed state. Whatever
    // it inserts is fine — we're testing the SECOND run.
    await seedAllPermianSiteLocations();

    const sitesAfterFirst = await db
      .select({ id: s.siteLocationsTable.id })
      .from(s.siteLocationsTable);
    for (const r of sitesAfterFirst) {
      if (!sitesBefore.has(r.id)) newSiteIds.push(r.id);
    }

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
