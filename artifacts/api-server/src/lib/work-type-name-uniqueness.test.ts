// Verifies the case-insensitive uniqueness guarantee on work_types.name and
// proves that an import-style upsert keyed by canonical name is a no-op the
// second time around (no INSERTs, no unique-violations).
//
// The DB index lives in lib/db/src/schema/workTypes.ts:
//   uniqueIndex("work_types_canonical_name_unique").on(sql`lower(btrim(name))`)
//
// Without this index, a hand-edit (or a future seed/import adding a
// near-variant) could re-introduce duplicate work-type rows that would
// silently splinter partner_work_type_afes, vendor_work_types,
// work_type_site_locations, and ticket rate-card lookups across two
// work-type rows — the same problem we just fixed for partners with
// partners_canonical_name_unique and for vendors with
// vendors_canonical_name_unique. This test guards against that
// regression.
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
const MARKER = `wt-uniq-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)("work_types.name canonical uniqueness", () => {
  let db: typeof import("@workspace/db").db;
  let s: typeof import("@workspace/db");
  const createdIds: number[] = [];

  beforeAll(async () => {
    s = await import("@workspace/db");
    db = s.db;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(s.workTypesTable).where(eq(s.workTypesTable.id, id));
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
    const name = `${MARKER}-Frac Crew`;
    const [w] = await db
      .insert(s.workTypesTable)
      .values({ name, category: "Completions" })
      .returning({ id: s.workTypesTable.id });
    createdIds.push(w.id);

    await expectUniqueViolation(
      db.insert(s.workTypesTable).values({ name, category: "Completions" }),
      "work_types_global_canonical_name_unique",
    );
  });

  it("rejects a duplicate that differs only in case or whitespace", async () => {
    const name = `${MARKER}-Wireline Services`;
    const [w] = await db
      .insert(s.workTypesTable)
      .values({ name, category: "Completions" })
      .returning({ id: s.workTypesTable.id });
    createdIds.push(w.id);

    await expectUniqueViolation(
      db.insert(s.workTypesTable).values({
        name: `  ${name.toUpperCase()}  `,
        category: "Completions",
      }),
      "work_types_global_canonical_name_unique",
    );
  });

  it("import-style upsert by canonical name is a no-op the second time", async () => {
    // Mirrors the /work-types/import upsert pattern: look up the row by
    // canonical name, insert only if missing. Run twice; the second run
    // must find the row and skip.
    const seedName = `${MARKER}-Hot Oil Treatment`;
    const seedRow = { name: seedName, category: "Production" };

    type Counts = { inserted: number; unchanged: number };
    async function runImport(): Promise<Counts> {
      let inserted = 0;
      let unchanged = 0;
      const [existing] = await db
        .select({ id: s.workTypesTable.id })
        .from(s.workTypesTable)
        .where(
          sql`lower(btrim(${s.workTypesTable.name})) = lower(btrim(${seedRow.name}))`,
        )
        .limit(1);
      if (!existing) {
        const [w] = await db
          .insert(s.workTypesTable)
          .values(seedRow)
          .returning({ id: s.workTypesTable.id });
        createdIds.push(w.id);
        inserted++;
      } else {
        unchanged++;
      }
      return { inserted, unchanged };
    }

    const first = await runImport();
    expect(first).toEqual({ inserted: 1, unchanged: 0 });

    const second = await runImport();
    expect(second).toEqual({ inserted: 0, unchanged: 1 });

    // And the second run must work even if the existing row's name has
    // been hand-edited to a different case / whitespace shape — the
    // canonical lookup finds it instead of falling through to an
    // INSERT that would now hit the unique-violation.
    await db
      .update(s.workTypesTable)
      .set({ name: `   ${seedName.toLowerCase()}   ` })
      .where(eq(s.workTypesTable.id, createdIds[createdIds.length - 1]));

    const third = await runImport();
    expect(third).toEqual({ inserted: 0, unchanged: 1 });
  });
});
