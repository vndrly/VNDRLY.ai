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
 *   1. Resolves a test DB URL.
 *      - Honors `TEST_DATABASE_URL` verbatim if set.
 *      - Otherwise derives `<dev-db>_test` on the same Postgres server
 *        as `DATABASE_URL`.
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

interface ResolvedUrls {
  testUrl: string;
  maintenanceUrl: string;
  testDbName: string;
  source: "TEST_DATABASE_URL" | "derived-from-DATABASE_URL";
}

function resolveTestDbUrl(): ResolvedUrls {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  const base = process.env.DATABASE_URL?.trim();

  if (!explicit && !base) {
    throw new Error(
      "Neither TEST_DATABASE_URL nor DATABASE_URL is set; cannot bootstrap an isolated test database.",
    );
  }

  // Refuse to derive a test DB from the placeholder fallback used by
  // `src/test/setup.ts` for offline unit-only runs — there is no
  // server there to create a database on.
  if (!explicit && base!.includes("test:test@localhost")) {
    throw new Error(
      "DATABASE_URL points at the offline placeholder (test:test@localhost). Set TEST_DATABASE_URL or a real DATABASE_URL to run integration tests.",
    );
  }

  const url = new URL(explicit ?? base!);
  if (!explicit) {
    const baseName = url.pathname.replace(/^\//, "") || "postgres";
    if (!baseName.endsWith("_test")) {
      url.pathname = `/${baseName}_test`;
    }
  }
  const testDbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!testDbName) {
    throw new Error(
      "Resolved test DB URL has no database name; refusing to proceed.",
    );
  }

  // Maintenance connection points at the well-known `postgres` DB on
  // the same server so we can issue CREATE DATABASE without being
  // connected to the target.
  const maintenance = new URL(url.toString());
  maintenance.pathname = "/postgres";

  return {
    testUrl: url.toString(),
    maintenanceUrl: maintenance.toString(),
    testDbName,
    source: explicit ? "TEST_DATABASE_URL" : "derived-from-DATABASE_URL",
  };
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
        process.stderr.write(`[test-db] child terminated by signal ${signal}\n`);
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

async function main(): Promise<void> {
  const childArgs = parseChildArgs(process.argv.slice(2));
  if (childArgs.length === 0) {
    throw new Error(
      "Usage: tsx scripts/run-with-test-db.ts -- <command> [args...]",
    );
  }

  const resolved = resolveTestDbUrl();
  process.stdout.write(
    `[test-db] Using isolated test database "${resolved.testDbName}" (${resolved.source}): ${redactPassword(resolved.testUrl)}\n`,
  );

  await ensureDatabaseExists(resolved.maintenanceUrl, resolved.testDbName);
  await resetAndPushSchema(resolved.testUrl);
  process.stdout.write(
    "[test-db] Schema applied to clean test database. Starting child process.\n",
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: resolved.testUrl,
    TEST_DATABASE_URL: resolved.testUrl,
  };

  const checkCode = await spawnChild(
    "pnpm",
    ["--filter", "@workspace/db", "run", "check-schema"],
    env,
  );
  if (checkCode !== 0) {
    process.exit(checkCode);
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
