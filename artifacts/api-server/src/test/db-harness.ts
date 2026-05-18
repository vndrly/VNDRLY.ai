/**
 * db-harness.ts
 *
 * Reusable per-test-file Postgres isolation for integration-style tests.
 *
 * Why this exists
 * ---------------
 * `scripts/run-with-test-db.ts` already keeps test runs off the shared
 * dev DB by spinning up a `<dev>_test` database for each `pnpm test`
 * invocation. That solves cross-run isolation, but it does not isolate
 * test files from each other inside a single run, and it leaves any
 * integration-style test on the hook for hand-rolled fixture cleanup
 * (the original visitor-notifier test seeded rows with a marker string
 * and deleted them by `name LIKE ${MARKER}-%` in afterAll). A crashed
 * test left orphan rows; two tests writing to the same tables could
 * interfere with each other.
 *
 * This module standardizes on a per-test-file "isolated schema":
 *
 *   1. `createIsolatedSchema(label)` snapshots the public schema's DDL
 *      via `pg_dump --schema-only --schema=public`, rewrites every
 *      `public.` qualifier to point at a fresh, randomly-named schema
 *      (e.g. `vitest_notifications_<ts>_<rand>`), and applies it.
 *   2. The returned URL has `?options=-c search_path=<schema>,public`
 *      appended, so any consumer that connects with that URL — including
 *      `@workspace/db`'s pool — automatically reads & writes inside the
 *      isolated schema without any code changes.
 *   3. `handle.teardown()` drops the schema CASCADE, removing every row
 *      and table the test touched in a single statement.
 *   4. `dropStaleIsolatedSchemas()` sweeps any `vitest_*` schemas left
 *      behind by a prior crashed run (older than `STALE_SCHEMA_AGE_MS`).
 *
 * Vitest's default `pool: 'forks'` runs each `*.test.ts` file in its
 * own worker, so calling this in a top-level `beforeAll` gives the
 * file its own DB universe for the lifetime of the suite.
 *
 * Typical usage:
 *
 *     import { afterAll, beforeAll, describe } from "vitest";
 *     import {
 *       createIsolatedSchema,
 *       dropStaleIsolatedSchemas,
 *       hasReachableDatabase,
 *       type IsolatedSchemaHandle,
 *     } from "../test/db-harness";
 *
 *     const HAVE_DB = await hasReachableDatabase();
 *     let handle: IsolatedSchemaHandle | null = null;
 *     let dbModule: typeof import("@workspace/db");
 *
 *     describe.runIf(HAVE_DB)("my integration test", () => {
 *       beforeAll(async () => {
 *         await dropStaleIsolatedSchemas();
 *         handle = await createIsolatedSchema("my-feature");
 *         process.env.DATABASE_URL = handle.url;
 *         dbModule = await import("@workspace/db");
 *         // ...seed via dbModule.db
 *       });
 *
 *       afterAll(async () => {
 *         try { await dbModule?.pool.end(); } finally {
 *           await handle?.teardown();
 *         }
 *       });
 *     });
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const execFileP = promisify(execFile);

/**
 * Prefix for every schema this harness creates. Used by the stale-schema
 * sweep to identify candidates for cleanup; do not change it without
 * also updating the sweep query.
 */
export const ISOLATED_SCHEMA_PREFIX = "vitest_";

/**
 * Schemas left behind by crashed runs older than this are dropped on
 * the next call to `dropStaleIsolatedSchemas()`. One hour is generous
 * enough that an in-progress, slow test run won't accidentally have
 * its schema dropped from underneath it.
 */
const STALE_SCHEMA_AGE_MS = 60 * 60 * 1000;

export type IsolatedSchemaHandle = {
  /** The connection string to hand to `@workspace/db` (or any pg client). */
  url: string;
  /** The isolated schema name; useful for diagnostics & assertions. */
  schema: string;
  /** Drop the schema CASCADE. Safe to call more than once. */
  teardown: () => Promise<void>;
};

/**
 * Quick connectivity probe that mirrors the one the visitor-notifier
 * test used to embed inline. Returns false for the offline placeholder
 * `postgres://test:test@localhost:5432/test` written by the unit-test
 * setup so suites can `describe.runIf(HAVE_DB)` cleanly.
 */
export async function hasReachableDatabase(
  url: string | undefined = process.env.DATABASE_URL,
): Promise<boolean> {
  if (!url) return false;
  if (url.includes("test:test@localhost")) return false;
  const client = new pg.Client({ connectionString: url });
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

/**
 * Create an isolated Postgres schema cloned from the source DB's
 * `public` schema and return a connection string scoped to it.
 */
export async function createIsolatedSchema(
  label: string,
  sourceUrl: string | undefined = process.env.DATABASE_URL,
): Promise<IsolatedSchemaHandle> {
  if (!sourceUrl) {
    throw new Error(
      "createIsolatedSchema: DATABASE_URL is not set; cannot snapshot the public schema.",
    );
  }
  if (sourceUrl.includes("test:test@localhost")) {
    throw new Error(
      "createIsolatedSchema: refusing to snapshot the offline placeholder DATABASE_URL. " +
        "Run via `pnpm --filter @workspace/api-server test` so an isolated test DB is provisioned first.",
    );
  }

  const schema = generateSchemaName(label);
  const ddl = await dumpPublicSchemaDdl(sourceUrl);
  const rewritten = rewritePublicQualifiers(ddl, schema);

  const admin = new pg.Client({ connectionString: sourceUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    try {
      await admin.query(rewritten);
    } catch (err) {
      await admin
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
      throw err;
    }
  } finally {
    await admin.end().catch(() => undefined);
  }

  return {
    url: appendSearchPathOption(sourceUrl, schema),
    schema,
    teardown: () => dropSchema(sourceUrl, schema),
  };
}

/**
 * Drop any `vitest_*` schemas older than `STALE_SCHEMA_AGE_MS`. Called
 * by integration test files at the top of `beforeAll` so a crashed
 * prior run can't leave the test DB cluttered with abandoned schemas.
 */
export async function dropStaleIsolatedSchemas(
  sourceUrl: string | undefined = process.env.DATABASE_URL,
  maxAgeMs: number = STALE_SCHEMA_AGE_MS,
): Promise<string[]> {
  if (!sourceUrl) return [];
  if (sourceUrl.includes("test:test@localhost")) return [];

  const cutoff = Date.now() - maxAgeMs;
  const dropped: string[] = [];
  const client = new pg.Client({ connectionString: sourceUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name LIKE $1`,
      [`${ISOLATED_SCHEMA_PREFIX}%`],
    );
    for (const { schema_name: name } of rows) {
      const ts = parseTimestampFromSchemaName(name);
      if (ts === null || ts < cutoff) {
        await client
          .query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`)
          .catch(() => undefined);
        dropped.push(name);
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }
  return dropped;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function generateSchemaName(label: string): string {
  const safe = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ISOLATED_SCHEMA_PREFIX}${safe || "test"}_${ts}_${rand}`;
}

function parseTimestampFromSchemaName(name: string): number | null {
  // Schema names look like `vitest_<label>_<timestamp>_<rand>`. The
  // timestamp is always the second-to-last underscore-delimited piece.
  const parts = name.split("_");
  if (parts.length < 4) return null;
  const ts = Number(parts[parts.length - 2]);
  return Number.isFinite(ts) ? ts : null;
}

async function dumpPublicSchemaDdl(sourceUrl: string): Promise<string> {
  // pg_dump speaks libpq URI directly. We pass --no-owner / --no-privileges
  // so the dump doesn't try to (re)assign ownership to whatever role the
  // dev DB uses, and --no-comments to keep COMMENT ON statements out of
  // the rewrite path (we'd otherwise need to filter their literal bodies
  // for `public.` references).
  const { stdout } = await execFileP(
    "pg_dump",
    [
      "--no-owner",
      "--no-privileges",
      "--no-comments",
      "--schema=public",
      "--schema-only",
      sourceUrl,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

function rewritePublicQualifiers(dump: string, schema: string): string {
  const quoted = `"${schema}"`;
  const lines = dump.split("\n");
  const filtered: string[] = [];
  for (const raw of lines) {
    const line = raw.trimStart();
    // Strip psql meta-commands (\restrict / \unrestrict / \connect / etc.)
    // — they aren't valid SQL when sent over a normal connection.
    if (line.startsWith("\\")) continue;
    // Skip the `CREATE SCHEMA public;` line; we are reusing the existing
    // public schema as the source of truth, not recreating it.
    if (/^CREATE\s+SCHEMA\s+public\s*;/i.test(line)) continue;
    // Skip the dump's pg_catalog.set_config('search_path', '', false)
    // line; we want connections to use the search_path embedded in our
    // returned URL, not whatever the dump wanted.
    if (/^SELECT\s+pg_catalog\.set_config\(\s*'search_path'/i.test(line))
      continue;
    // Bare `SET search_path = ...;` lines are likewise irrelevant for
    // session-less DDL we're about to apply with our own search_path.
    if (/^SET\s+search_path\s*=/i.test(line)) continue;
    filtered.push(raw);
  }
  // `\bpublic\.` only matches `public.` at a word boundary, so it
  // correctly skips identifiers like `is_public.` (`_` is a word char,
  // so there is no boundary between `_` and `p`). The dump never
  // includes string literals that mention `public.<name>` because we
  // pass --schema-only and --no-comments.
  return filtered.join("\n").replace(/\bpublic\./g, `${quoted}.`);
}

function appendSearchPathOption(url: string, schema: string): string {
  const u = new URL(url);
  // node-postgres forwards the `options` query parameter to the Postgres
  // server as the libpq `options` startup parameter, which lets us pin
  // the per-connection `search_path` without touching application code.
  const existing = u.searchParams.get("options") ?? "";
  const next = `${existing} -c search_path=${schema},public`.trim();
  u.searchParams.set("options", next);
  return u.toString();
}

async function dropSchema(sourceUrl: string, schema: string): Promise<void> {
  const client = new pg.Client({ connectionString: sourceUrl });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
