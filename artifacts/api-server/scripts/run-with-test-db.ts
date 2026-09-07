/**
 * run-with-test-db.ts
 *
 * Bootstraps an isolated Postgres database for a test run, applies the
 * `@workspace/db` schema to it, and then spawns the given child command
 * with `DATABASE_URL` rewritten to point at that test DB.
 *
 * Why this exists
 * ---------------
 * The api-server test suite (and the `check-schema` drift gate) used to
 * run against whatever `DATABASE_URL` happened to be set in the shell —
 * which in practice is the shared dev database. That was bad on three
 * fronts:
 *   1. Test runs could mutate (or be polluted by) real dev data.
 *   2. Two devs running tests at the same time would collide.
 *   3. The schema-drift check was effectively a check of the dev DB,
 *      so a fresh `drizzle-kit push` against a clean schema could
 *      legitimately fail (e.g. `vendors_canonical_name_unique` failing
 *      to create because dev had duplicate vendor rows).
 *
 * What it does
 * ------------
 * With VNDRLY_TEST_DB_MODE=fresh-local, ignores inherited database URLs,
 * creates a unique NEW database on the explicit loopback maintenance server,
 * validates and applies only additive schema statements, and retains the DB.
 * No existing database is reused or reset in this mode. See lib/e2e/README.md.
 *
 * The legacy mode below is preserved for existing callers; its schema reset
 * is not authorized by the no-wipe local validation workflow.
 *
 *   1. Resolves a test DB URL.
 *      - Honors `TEST_DATABASE_URL` only when it names a distinct `_test`
 *        target.
 *      - Otherwise derives `<dev-db>_test` on the same Postgres server
 *        as `DATABASE_URL`.
 *      - Accepts only explicit, query-free Postgres URLs with a safe hostname,
 *        numeric port, and ASCII database name, then rebuilds a canonical URL.
 *      - Removes libpq target fallback variables before any connection.
 *   2. Ensures that DB exists (creates it via the maintenance `postgres`
 *      DB on the same server if necessary).
 *   3. Drops + recreates the `public` schema in the test DB so it
 *      always starts empty.
 *   4. Pushes the current `@workspace/db` schema into it via
 *      drizzle-kit's `pushSchema(...).apply()` (the same surface the
 *      `check-schema` drift gate uses).
 *   5. Spawns the requested child command with
 *      `DATABASE_URL=<test url>` so vitest, the drift check, and any
 *      ad-hoc test runs all see the isolated DB.
 *
 * Usage
 * -----
 *   tsx scripts/run-with-test-db.ts -- <command> [args...]
 *
 * Example (the api-server `test` npm script):
 *   tsx scripts/run-with-test-db.ts -- \
 *       sh -c "pnpm --filter @workspace/db run check-schema && vitest run"
 */
import "../../../scripts/load-env-local.mjs";
import { spawn } from "node:child_process";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { pushSchema } from "drizzle-kit/api";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import {
  freshLocalChildEnvironment,
  provisionFreshLocalTestDatabase,
  resolveFreshLocalTestDatabaseTarget,
} from "../../../scripts/fresh-test-database.mjs";
import {
  resolveIsolatedTestDatabaseTarget,
  stripLibpqTargetEnvironment,
} from "../../../scripts/e2e-isolation.mjs";

interface ResolvedUrls {
  testUrl: string;
  maintenanceUrl: string;
  testDbName: string;
  listenNotifyTestUrl?: string;
  source: "TEST_DATABASE_URL" | "derived-from-DATABASE_URL";
}

function resolveTestDbUrl(): ResolvedUrls {
  return resolveIsolatedTestDatabaseTarget(process.env);
}

async function ensureDatabaseExists(
  maintenanceUrl: string,
  testDbName: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    const exists = await client.query<{ count: string }>(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [testDbName],
    );
    if (exists.rowCount === 0) {
      // Quote the identifier; pg has no parameter binding for DDL.
      const quoted = `"${testDbName.replace(/"/g, '""')}"`;
      await client.query(`CREATE DATABASE ${quoted}`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function resetAndPushSchema(testUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: testUrl, max: 4 });
  try {
    const client = await pool.connect();
    try {
      // DROP+CREATE the public schema is functionally equivalent to
      // dropping and recreating the database, but doesn't require us
      // to terminate connections or reconnect. It's also dramatically
      // faster than CREATE DATABASE on most setups.
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");
    } finally {
      client.release();
    }

    const db = drizzle(pool, { schema });
    const { apply } = await pushSchema(
      schema as Record<string, unknown>,
      db as unknown as PgDatabase<never>,
    );
    await apply();
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function spawnChild(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        process.stderr.write(
          `[test-db] child terminated by signal ${signal}\n`,
        );
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

function redactPassword(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

function parseChildArgs(argv: string[]): string[] {
  const sep = argv.indexOf("--");
  return sep >= 0 ? argv.slice(sep + 1) : argv;
}

function schemaDriftSkipReason(resolved: ResolvedUrls): string | null {
  if (process.env.SKIP_SCHEMA_DRIFT_CHECK === "1") {
    return "SKIP_SCHEMA_DRIFT_CHECK=1";
  }
  try {
    const url = new URL(resolved.testUrl);
    if (url.hostname.endsWith(".pooler.supabase.com")) {
      return "Supabase pooler introspection workaround";
    }
  } catch {
    // If the URL was good enough to connect above, this should not run.
  }
  return null;
}

async function main(): Promise<void> {
  const childArgs = parseChildArgs(process.argv.slice(2));
  if (childArgs.length === 0) {
    throw new Error(
      "Usage: tsx scripts/run-with-test-db.ts -- <command> [args...]",
    );
  }

  const setupEnvironment = stripLibpqTargetEnvironment(process.env);
  for (const key of Object.keys(process.env)) {
    if (!(key in setupEnvironment)) {
      delete process.env[key];
    }
  }

  if (process.env.VNDRLY_TEST_DB_MODE === "fresh-local") {
    const target = resolveFreshLocalTestDatabaseTarget(setupEnvironment);
    const env = freshLocalChildEnvironment(setupEnvironment, target);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    process.stdout.write(
      `[test-db] Creating new local database "${target.testDbName}". It will be retained after this run.\n`,
    );
    await provisionFreshLocalTestDatabase(
      target,
      (url) => new pg.Client({ connectionString: url }),
      async (client) =>
        pushSchema(
          schema as Record<string, unknown>,
          drizzle(client, { schema }) as unknown as PgDatabase<never>,
        ),
    );
    process.stdout.write(
      "[test-db] Additive schema applied; checking schema before starting tests.\n",
    );
    const checkCode = await spawnChild(
      "corepack",
      ["pnpm", "--filter", "@workspace/db", "run", "check-schema"],
      env,
    );
    if (checkCode !== 0) process.exit(checkCode);
    process.exit(await spawnChild(childArgs[0]!, childArgs.slice(1), env));
  }
  if (process.env.VNDRLY_TEST_DB_MODE) {
    throw new Error(
      "Unknown VNDRLY_TEST_DB_MODE; supported explicit mode is fresh-local",
    );
  }

  const resolved = resolveTestDbUrl();
  process.env.DATABASE_URL = resolved.testUrl;
  process.env.TEST_DATABASE_URL = resolved.testUrl;
  const listenNotifyTestUrl = resolved.listenNotifyTestUrl;
  if (listenNotifyTestUrl) {
    process.env.LISTEN_NOTIFY_DATABASE_URL = listenNotifyTestUrl;
  } else {
    delete process.env.LISTEN_NOTIFY_DATABASE_URL;
  }
  process.stdout.write(
    `[test-db] Using isolated test database "${resolved.testDbName}" (${resolved.source}): ${redactPassword(resolved.testUrl)}\n`,
  );

  await ensureDatabaseExists(resolved.maintenanceUrl, resolved.testDbName);
  await resetAndPushSchema(resolved.testUrl);
  process.stdout.write(
    "[test-db] Schema applied to clean test database. Starting child process.\n",
  );

  const env: NodeJS.ProcessEnv = {
    ...setupEnvironment,
    DATABASE_URL: resolved.testUrl,
    TEST_DATABASE_URL: resolved.testUrl,
    VNDRLY_ISOLATED_TEST_DB: "1",
  };
  delete env.LISTEN_NOTIFY_DATABASE_URL;
  if (listenNotifyTestUrl) {
    env.LISTEN_NOTIFY_DATABASE_URL = listenNotifyTestUrl;
    process.stdout.write(
      `[test-db] LISTEN/NOTIFY URL scoped to test database: ${redactPassword(listenNotifyTestUrl)}\n`,
    );
  }

  const skipDriftReason = schemaDriftSkipReason(resolved);
  if (!skipDriftReason) {
    const schemaCheckEnv: NodeJS.ProcessEnv = listenNotifyTestUrl
      ? {
          ...env,
          DATABASE_URL: listenNotifyTestUrl,
          TEST_DATABASE_URL: listenNotifyTestUrl,
        }
      : env;
    const checkCode = await spawnChild(
      "corepack",
      ["pnpm", "--filter", "@workspace/db", "run", "check-schema"],
      schemaCheckEnv,
    );
    if (checkCode !== 0) {
      process.exit(checkCode);
    }
  } else {
    process.stdout.write(
      `[test-db] ${skipDriftReason} — skipping check-schema.\n`,
    );
  }

  const code = await spawnChild(childArgs[0]!, childArgs.slice(1), env);
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(
    `[test-db] Failed to set up isolated test database.\n${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
