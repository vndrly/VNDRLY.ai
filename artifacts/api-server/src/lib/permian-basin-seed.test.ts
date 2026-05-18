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

describe.runIf(haveRealDb)("seed-permian-basin idempotency", () => {
  let db: typeof import("@workspace/db").db;
  let s: typeof import("@workspace/db");
  let seedPartners: typeof import("../../scripts/seed-permian-basin.js").seedPartners;
  let seedVendors: typeof import("../../scripts/seed-permian-basin.js").seedVendors;

  // IDs the test inserted (rows that did not exist before the test ran).
  // Used by the cleanup hook so we never delete rows the dev DB had
  // before we touched it.
  const newPartnerIds: number[] = [];
  const newVendorIds: number[] = [];

  beforeAll(async () => {
    s = await import("@workspace/db");
    db = s.db;
    const seed = await import("../../scripts/seed-permian-basin.js");
    seedPartners = seed.seedPartners;
    seedVendors = seed.seedVendors;
  });

  afterAll(async () => {
    if (newPartnerIds.length > 0) {
      await db
        .delete(s.partnersTable)
        .where(inArray(s.partnersTable.id, newPartnerIds));
    }
    if (newVendorIds.length > 0) {
      await db
        .delete(s.vendorsTable)
        .where(inArray(s.vendorsTable.id, newVendorIds));
    }
  });

  it("re-running the seed makes no changes (no inserts, no enriches, no errors)", async () => {
    // Snapshot existing IDs so we can identify what the seed inserts and
    // delete only those rows in cleanup.
    const partnersBefore = new Set(
      (
        await db.select({ id: s.partnersTable.id }).from(s.partnersTable)
      ).map((r) => r.id),
    );
    const vendorsBefore = new Set(
      (
        await db.select({ id: s.vendorsTable.id }).from(s.vendorsTable)
      ).map((r) => r.id),
    );

    // First run: brings the DB up to the canonical seed state. Whatever
    // it inserts/enriches is fine — we're testing the SECOND run.
    await seedPartners();
    await seedVendors();

    const partnersAfterFirst = await db
      .select({ id: s.partnersTable.id })
      .from(s.partnersTable);
    const vendorsAfterFirst = await db
      .select({ id: s.vendorsTable.id })
      .from(s.vendorsTable);

    for (const r of partnersAfterFirst) {
      if (!partnersBefore.has(r.id)) newPartnerIds.push(r.id);
    }
    for (const r of vendorsAfterFirst) {
      if (!vendorsBefore.has(r.id)) newVendorIds.push(r.id);
    }

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
