// Verifies that the Mach Natural Resources site-locations seed script
// (artifacts/api-server/scripts/seed-mach-site-locations.ts) is idempotent:
// re-running it against an already-seeded DB inserts zero rows and never
// throws. Mirrors the pattern in permian-basin-seed.test.ts.
//
// Without this guard, a future edit (e.g. tweaking a site name's casing,
// or removing the (partnerId, name) existing-row check) would silently
// regress and only be noticed the next time someone ran the script by
// hand against a real customer DB.
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

describe.runIf(haveRealDb)("seed-mach-site-locations idempotency", () => {
  let db: typeof import("@workspace/db").db;
  let s: typeof import("@workspace/db");
  let seedMachSiteLocations: typeof import("../../scripts/seed-mach-site-locations.js").seedMachSiteLocations;
  let seedPartners: typeof import("../../scripts/seed-permian-basin.js").seedPartners;

  // IDs the test inserted (rows that did not exist before the test ran).
  // Used by the cleanup hook so we never delete rows the dev DB had
  // before we touched it.
  const newSiteIds: number[] = [];
  const newPartnerIds: number[] = [];

  beforeAll(async () => {
    s = await import("@workspace/db");
    db = s.db;
    const machSeed = await import("../../scripts/seed-mach-site-locations.js");
    seedMachSiteLocations = machSeed.seedMachSiteLocations;
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
    // Snapshot existing partner IDs so we can clean up any partner row we
    // had to insert via the prerequisite seed.
    const partnersBefore = new Set(
      (
        await db.select({ id: s.partnersTable.id }).from(s.partnersTable)
      ).map((r) => r.id),
    );

    // The Mach script requires the "Mach Natural Resources" partner row
    // to exist (it bails out if missing). Run the prerequisite partner
    // seed once so this test works on a fresh DB; cleanup below removes
    // anything new it added.
    await seedPartners();

    const partnersAfter = await db
      .select({ id: s.partnersTable.id })
      .from(s.partnersTable);
    for (const r of partnersAfter) {
      if (!partnersBefore.has(r.id)) newPartnerIds.push(r.id);
    }

    // Now snapshot site IDs so we can identify what the Mach seed inserts.
    const sitesBefore = new Set(
      (
        await db
          .select({ id: s.siteLocationsTable.id })
          .from(s.siteLocationsTable)
      ).map((r) => r.id),
    );

    // First run: brings the DB up to the canonical seed state. Whatever
    // it inserts is fine — we're testing the SECOND run.
    const firstRun = await seedMachSiteLocations();
    expect(firstRun.partnerMissing).toBe(false);

    const sitesAfterFirst = await db
      .select({ id: s.siteLocationsTable.id })
      .from(s.siteLocationsTable);
    for (const r of sitesAfterFirst) {
      if (!sitesBefore.has(r.id)) newSiteIds.push(r.id);
    }

    // Second run: this is the actual assertion. With the (partnerId, name)
    // existing-row check in place this MUST insert zero rows and MUST NOT
    // throw. If a future edit sneaks in a near-duplicate site (e.g. a
    // renamed county), this assertion will catch it.
    const secondRun = await seedMachSiteLocations();
    expect(secondRun.inserted).toBe(0);
    expect(secondRun.partnerMissing).toBe(false);
  }, 60_000);
});
