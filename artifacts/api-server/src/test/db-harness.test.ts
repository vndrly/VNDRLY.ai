import { describe, expect, it } from "vitest";
import pg from "pg";
import { execFile } from "node:child_process";
import {
  ISOLATED_SCHEMA_PREFIX,
  createIsolatedSchema,
  dropStaleIsolatedSchemas,
  hasReachableDatabase,
} from "./db-harness";

// Sanity checks for the isolated-schema harness itself. These exercise
// the contract `notifications.test.ts` (and any future integration test)
// relies on:
//   - the cloned schema has the public DDL applied (e.g. `partners`)
//   - writes go into the isolated schema, NOT the source
//   - teardown drops the schema
//   - the stale-sweep targets only old `vitest_*` schemas, never anything else

const HAVE_DB = await hasReachableDatabase();
const FRESH_LOCAL = process.env.VNDRLY_TEST_DB_MODE === "fresh-local";
const HAVE_PG_DUMP = FRESH_LOCAL ? false : await hasPgDump();

function hasPgDump(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("pg_dump", ["--version"], (err) => resolve(!err));
  });
}

describe.runIf(!FRESH_LOCAL && HAVE_DB && HAVE_PG_DUMP)("db-harness", () => {
  it("creates an isolated schema with the public schema's tables and confines writes to it", async () => {
    const handle = await createIsolatedSchema("harness-self-test");
    try {
      expect(handle.schema.startsWith(ISOLATED_SCHEMA_PREFIX)).toBe(true);
      // URL-encodes the embedded `-c search_path=<schema>,public` libpq
      // option, so decode the `options` query param before asserting.
      const opts = new URL(handle.url).searchParams.get("options") ?? "";
      expect(opts).toContain(`search_path=${handle.schema},public`);

      const isolated = new pg.Client({ connectionString: handle.url });
      await isolated.connect();
      try {
        const cur = await isolated.query<{ current_schema: string }>(
          "SELECT current_schema()",
        );
        expect(cur.rows[0]?.current_schema).toBe(handle.schema);

        const ins = await isolated.query<{ id: number }>(
          "INSERT INTO partners (name, contact_name, contact_email) " +
            "VALUES ('harness-isolated', 'x', 'x@y.z') RETURNING id",
        );
        expect(ins.rows[0]?.id).toBeGreaterThan(0);

        const inIsolated = await isolated.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM partners WHERE name = 'harness-isolated'",
        );
        expect(inIsolated.rows[0]?.n).toBe(1);
      } finally {
        await isolated.end().catch(() => undefined);
      }

      // The same row must not be visible in the source DB's public
      // schema — that's the whole point of the harness.
      const source = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await source.connect();
      try {
        const cnt = await source.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM public.partners WHERE name = 'harness-isolated'",
        );
        expect(cnt.rows[0]?.n).toBe(0);
      } finally {
        await source.end().catch(() => undefined);
      }
    } finally {
      await handle.teardown();
    }

    // After teardown the schema must be gone so a future run can reuse the name.
    const verify = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await verify.connect();
    try {
      const exists = await verify.query(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
        [handle.schema],
      );
      expect(exists.rowCount).toBe(0);
    } finally {
      await verify.end().catch(() => undefined);
    }
  }, 60_000);

  it("dropStaleIsolatedSchemas only targets old vitest_* schemas", async () => {
    // A freshly-created schema must NOT be swept; it carries a current
    // timestamp embedded in its name and is younger than the cutoff.
    const fresh = await createIsolatedSchema("harness-fresh-sweep");
    try {
      const dropped = await dropStaleIsolatedSchemas();
      expect(dropped).not.toContain(fresh.schema);
    } finally {
      await fresh.teardown();
    }

    // With a zero-ms cutoff, the same fresh schema (recreated) is now
    // older than the cutoff and should be reaped. This locks in the
    // sweep behavior so a future change to the parser/regex will fail
    // loudly here instead of silently leaking schemas.
    const reaped = await createIsolatedSchema("harness-reap-sweep");
    const dropped = await dropStaleIsolatedSchemas(undefined, 0);
    expect(dropped).toContain(reaped.schema);

    const verify = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await verify.connect();
    try {
      const exists = await verify.query(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
        [reaped.schema],
      );
      expect(exists.rowCount).toBe(0);
    } finally {
      await verify.end().catch(() => undefined);
    }
  }, 60_000);
});

describe.skipIf(FRESH_LOCAL || (HAVE_DB && HAVE_PG_DUMP))("db-harness", () => {
  it.skip("requires a real Postgres DATABASE_URL and pg_dump on PATH", () => {
    // Skipped offline; the harness exists exclusively for tests that
    // need a real server to clone the public schema from.
  });
});

describe.runIf(FRESH_LOCAL && HAVE_DB)(
  "db-harness fresh local retention",
  () => {
    it("confines fixture writes to a new database and retains them through teardown and stale cleanup", async () => {
      const sourceUrl = process.env.DATABASE_URL;
      const handle = await createIsolatedSchema("fresh-harness");
      expect(handle.url).not.toBe(sourceUrl);
      expect(new URL(handle.url).search).toBe("");
      const isolated = new pg.Client({ connectionString: handle.url });
      const source = new pg.Client({ connectionString: sourceUrl });
      await isolated.connect();
      await source.connect();
      try {
        await isolated.query(
          "INSERT INTO partners (name, contact_name, contact_email) VALUES ('fresh-harness-owned', 'Fixture', 'fixture@example.test')",
        );
        expect(
          (
            await source.query(
              "SELECT id FROM partners WHERE name = 'fresh-harness-owned'",
            )
          ).rowCount,
        ).toBe(0);
        handle.activate();
        expect(process.env.DATABASE_URL).toBe(handle.url);
        expect(process.env.TEST_DATABASE_URL).toBe(handle.url);
        expect(process.env.LISTEN_NOTIFY_DATABASE_URL).toBe(handle.url);
        expect(await dropStaleIsolatedSchemas(undefined, 0)).toEqual([]);
        await handle.teardown();
        expect(process.env.DATABASE_URL).toBe(sourceUrl);
        expect(
          (
            await isolated.query(
              "SELECT id FROM partners WHERE name = 'fresh-harness-owned'",
            )
          ).rowCount,
        ).toBe(1);
        await handle.teardown();
      } finally {
        await isolated.end();
        await source.end();
        await handle.teardown();
      }
    }, 60_000);
  },
);
