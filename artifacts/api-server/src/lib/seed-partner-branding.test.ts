// Verifies that the partner-branding seed script
// (artifacts/api-server/scripts/seed-partner-branding.ts) is idempotent:
// re-running it against an already-branded DB fills zero logos, fills
// zero colors, and never throws. Mirrors the pattern in
// permian-basin-seed.test.ts.
//
// Without this guard, a future edit (e.g. dropping the
// !target.logoUrl / !target.brandPrimaryColor merge-blanks checks) would
// silently regress and stomp user-typed branding the next time someone
// ran the script by hand against a real customer DB.
//
// Skips with a no-op describe when DATABASE_URL is unavailable so CI can
// still run the rest of the unit suite.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { eq, inArray } from "drizzle-orm";

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

type PartnerBrandSnapshot = {
  id: number;
  logoUrl: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
};

describe.runIf(haveRealDb)("seed-partner-branding idempotency", () => {
  let db: typeof import("@workspace/db").db;
  let s: typeof import("@workspace/db");
  let seedPartnerBranding: typeof import("../../scripts/seed-partner-branding.js").seedPartnerBranding;
  let seedPartners: typeof import("../../scripts/seed-permian-basin.js").seedPartners;

  // Rows the test inserted via the prerequisite partner seed.
  const newPartnerIds: number[] = [];
  // Pre-test branding snapshot for every partner row, so the cleanup hook
  // can restore branding fields the seed filled in. We snapshot ALL
  // partner rows (cheap) and only reset rows whose branding differs from
  // the snapshot — this is safer than guessing which rows the seed
  // touched.
  const brandingSnapshot: PartnerBrandSnapshot[] = [];

  beforeAll(async () => {
    s = await import("@workspace/db");
    db = s.db;
    const branding = await import(
      "../../scripts/seed-partner-branding.js"
    );
    seedPartnerBranding = branding.seedPartnerBranding;
    const permianSeed = await import("../../scripts/seed-permian-basin.js");
    seedPartners = permianSeed.seedPartners;
  });

  afterAll(async () => {
    // Restore any branding fields the seed filled. We treat the
    // snapshot as authoritative and only update rows where the current
    // value differs (avoids spurious writes).
    if (brandingSnapshot.length > 0) {
      const current = await db
        .select({
          id: s.partnersTable.id,
          logoUrl: s.partnersTable.logoUrl,
          brandPrimaryColor: s.partnersTable.brandPrimaryColor,
          brandAccentColor: s.partnersTable.brandAccentColor,
        })
        .from(s.partnersTable)
        .where(
          inArray(
            s.partnersTable.id,
            brandingSnapshot.map((r) => r.id),
          ),
        );
      const byId = new Map(current.map((r) => [r.id, r]));
      for (const snap of brandingSnapshot) {
        const cur = byId.get(snap.id);
        if (!cur) continue;
        const patch: Record<string, unknown> = {};
        if (cur.logoUrl !== snap.logoUrl) patch.logoUrl = snap.logoUrl;
        if (cur.brandPrimaryColor !== snap.brandPrimaryColor)
          patch.brandPrimaryColor = snap.brandPrimaryColor;
        if (cur.brandAccentColor !== snap.brandAccentColor)
          patch.brandAccentColor = snap.brandAccentColor;
        if (Object.keys(patch).length > 0) {
          await db
            .update(s.partnersTable)
            .set(patch)
            .where(eq(s.partnersTable.id, snap.id));
        }
      }
    }

    if (newPartnerIds.length > 0) {
      await db
        .delete(s.partnersTable)
        .where(inArray(s.partnersTable.id, newPartnerIds));
    }
  });

  it("re-running the seed makes no changes (no logos filled, no colors filled, no errors)", async () => {
    // The branding script needs partner rows to brand. Run the
    // prerequisite partner seed once so this test works on a fresh DB.
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

    // Snapshot branding fields for every partner BEFORE we run the
    // branding seed, so cleanup can restore them.
    const snap = await db
      .select({
        id: s.partnersTable.id,
        logoUrl: s.partnersTable.logoUrl,
        brandPrimaryColor: s.partnersTable.brandPrimaryColor,
        brandAccentColor: s.partnersTable.brandAccentColor,
      })
      .from(s.partnersTable);
    brandingSnapshot.push(...snap);

    // First run: brings the DB up to the canonical seed state. Whatever
    // it fills is fine — we're testing the SECOND run.
    await seedPartnerBranding();

    // Second run: this is the actual assertion. With the merge-blanks
    // checks (!target.logoUrl, !target.brandPrimaryColor) in place this
    // MUST fill zero logos, zero colors, and MUST NOT throw. If a future
    // edit drops a guard, this assertion catches it.
    const secondRun = await seedPartnerBranding();
    expect(secondRun.logoFilled).toBe(0);
    expect(secondRun.colorsFilled).toBe(0);
    // After a fresh partner seed, every spec must match a partner row —
    // otherwise the second-run "0 fills" assertion could mask a spec
    // that silently skipped because its partner row wasn't found.
    expect(secondRun.notFound).toEqual([]);
  }, 120_000);
});
