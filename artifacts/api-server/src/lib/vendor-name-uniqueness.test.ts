// Verifies the case-insensitive uniqueness guarantee on vendors.name and
// proves that re-running the Permian-Basin seed against an already-seeded
// DB is a no-op (no INSERTs, no unique-violations).
//
// The DB index lives in lib/db/src/schema/vendors.ts:
//   uniqueIndex("vendors_canonical_name_unique").on(sql`lower(btrim(name))`)
//
// Without this index, repeated demo seeds historically created splinter
// rows like "Baker Hughes" + "Baker Hughes Field Svcs" or two
// "Select Water Solutions" rows with different ids. The dedupe-vendors
// script merged those, but nothing prevented the next re-seed from
// re-introducing them. This test guards against that regression.
//
// Skips with a no-op describe when DATABASE_URL is unavailable so CI can
// still run the rest of the unit suite.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { eq, sql } from "drizzle-orm";

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

// Marker so the cleanup hook only deletes rows this suite created.
const MARKER = `vendor-uniq-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)("vendors.name canonical uniqueness", () => {
  let db: typeof import("@workspace/db").db;
  let s: typeof import("@workspace/db");
  const createdIds: number[] = [];

  beforeAll(async () => {
    s = await import("@workspace/db");
    db = s.db;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, id));
    }
  });

  // Drizzle wraps the underlying pg error in a "Failed query" message; the
  // real Postgres error is on `.cause`. Check both the wrapped error and
  // the cause's `code` (23505 = unique_violation) and constraint name.
  async function expectUniqueViolation(
    p: Promise<unknown>,
    constraint: string,
  ) {
    let caught: unknown = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught, "expected the insert to fail").not.toBeNull();
    const cause = (caught as { cause?: { code?: string; constraint?: string } })
      .cause;
    expect(cause?.code, "expected a Postgres unique-violation (23505)").toBe(
      "23505",
    );
    expect(cause?.constraint).toBe(constraint);
  }

  it("rejects an exact-duplicate name", async () => {
    const name = `${MARKER}-Acme`;
    const [v] = await db
      .insert(s.vendorsTable)
      .values({
        name,
        contactName: "First Contact",
        contactEmail: `${MARKER}-1@example.com`,
      })
      .returning({ id: s.vendorsTable.id });
    createdIds.push(v.id);

    await expectUniqueViolation(
      db.insert(s.vendorsTable).values({
        name,
        contactName: "Second Contact",
        contactEmail: `${MARKER}-2@example.com`,
      }),
      "vendors_canonical_name_unique",
    );
  });

  it("rejects a duplicate that differs only in case or whitespace", async () => {
    const name = `${MARKER}-Beta Co`;
    const [v] = await db
      .insert(s.vendorsTable)
      .values({
        name,
        contactName: "First Contact",
        contactEmail: `${MARKER}-3@example.com`,
      })
      .returning({ id: s.vendorsTable.id });
    createdIds.push(v.id);

    await expectUniqueViolation(
      db.insert(s.vendorsTable).values({
        name: `  ${name.toUpperCase()}  `,
        contactName: "Second Contact",
        contactEmail: `${MARKER}-4@example.com`,
      }),
      "vendors_canonical_name_unique",
    );
  });

  it("seed-style upsert by canonical name is a no-op the second time", async () => {
    // Mirrors the seed-permian-basin.ts seedVendors() pattern: look up
    // the row by canonical name, insert only if missing. Run twice; the
    // second run must find the row and skip.
    const seedName = `${MARKER}-Gamma Industries`;
    const seedRow = {
      name: seedName,
      contactName: "Seed Contact",
      contactEmail: `${MARKER}-seed@example.com`,
    };

    type Counts = { inserted: number; unchanged: number };
    async function runSeed(): Promise<Counts> {
      let inserted = 0;
      let unchanged = 0;
      const [existing] = await db
        .select({ id: s.vendorsTable.id })
        .from(s.vendorsTable)
        .where(
          sql`lower(btrim(${s.vendorsTable.name})) = lower(btrim(${seedRow.name}))`,
        )
        .limit(1);
      if (!existing) {
        const [v] = await db
          .insert(s.vendorsTable)
          .values(seedRow)
          .returning({ id: s.vendorsTable.id });
        createdIds.push(v.id);
        inserted++;
      } else {
        unchanged++;
      }
      return { inserted, unchanged };
    }

    const first = await runSeed();
    expect(first).toEqual({ inserted: 1, unchanged: 0 });

    const second = await runSeed();
    expect(second).toEqual({ inserted: 0, unchanged: 1 });

    // And the second run must work even if the existing row's name has
    // been hand-edited to a different case / whitespace shape — the
    // canonical lookup finds it instead of falling through to an
    // INSERT that would now hit the unique-violation.
    await db
      .update(s.vendorsTable)
      .set({ name: `   ${seedName.toLowerCase()}   ` })
      .where(eq(s.vendorsTable.id, createdIds[createdIds.length - 1]));

    const third = await runSeed();
    expect(third).toEqual({ inserted: 0, unchanged: 1 });
  });
});
