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
 * Requires VNDRLY_TEST_DB_MODE=fresh-local, ignores inherited database URLs,
 * creates a unique NEW database on the explicit loopback maintenance server,
 * validates and applies only additive schema statements, and retains the DB.
 * No existing database is reused or reset in this mode. See lib/e2e/README.md.
 *
 * Refuses every legacy `_test` reset path. The wrapper may only create a new,
 * uniquely named loopback database and apply an additive schema plan.
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
import { stripLibpqTargetEnvironment } from "../../../scripts/e2e-isolation.mjs";

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

function parseChildArgs(argv: string[]): string[] {
  const sep = argv.indexOf("--");
  return sep >= 0 ? argv.slice(sep + 1) : argv;
}

// Private authentication state is intentionally absent from ordinary user
// projections. Apply its guarded migration after the schema drift check.
async function provisionPrivateAuthColumns(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS revoked_staff_sessions jsonb");
  } finally { await client.end(); }
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
    await provisionPrivateAuthColumns(target.testUrl);
    const fleetMigrationCode = await spawnChild(
      "corepack",
      ["pnpm", "--filter", "@workspace/api-server", "run", "migrate:fleet-mobile-workflows"],
      env,
    );
    if (fleetMigrationCode !== 0) process.exit(fleetMigrationCode);
    process.exit(await spawnChild(childArgs[0]!, childArgs.slice(1), env));
  }
  throw new Error(
    "API tests require VNDRLY_TEST_DB_MODE=fresh-local and an explicit loopback VNDRLY_TEST_DB_MAINTENANCE_URL; legacy database reset mode is disabled",
  );
}

main().catch((err) => {
  process.stderr.write(
    `[test-db] Failed to set up isolated test database.\n${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
