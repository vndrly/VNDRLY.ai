import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { pushSchema } from "drizzle-kit/api";
import pg from "pg";
import { assertFreshLocalTestDatabaseEnvironment, freshLocalChildEnvironment, provisionFreshLocalTestDatabase, resolveFreshLocalTestDatabaseTarget } from "../../../scripts/fresh-test-database.mjs";
import { createPlanExecution } from "../src/assistant/plan-execution";

/** Only a newly created owned loopback database; retained for diagnosis, never reset. */
async function main() {
  assert.equal(process.env.VNDRLY_LOAD_ENV_LOCAL, "0", "Rehearsal must not load shared configuration");
  const target = resolveFreshLocalTestDatabaseTarget(process.env);
  const childEnvironment = freshLocalChildEnvironment(process.env, target);
  childEnvironment.ASSISTANT_PLAN_EXECUTION_ENABLED = "0";
  assertFreshLocalTestDatabaseEnvironment(childEnvironment);
  await provisionFreshLocalTestDatabase(target, (url: string) => new pg.Client({ connectionString: url }), async (client: pg.Client) => {
    // Exact current full schema, not a reconstructed users table or a removed-column schema.
    const schema = await import("@workspace/db/schema");
    return pushSchema(schema, drizzle(client, { schema }) as unknown as PgDatabase<never>);
  });
  const client = new pg.Client({ connectionString: target.testUrl });
  await client.connect();
  try {
    const identity = (await client.query("SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port")).rows[0];
    assert.equal(identity.database, target.testDbName);
    assert.equal(identity.address, "127.0.0.1");
    assert.equal(String(identity.port), new URL(target.testUrl).port);
    const beforeColumn = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'assistant_plan_executions'");
    assert.equal(beforeColumn.rowCount, 0, "First application requires the private column to be absent in the exact baseline");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM users")).rows[0].count, 0);
    const marker = `assistant-plan-rehearsal-${randomUUID()}@example.invalid`;
    const userId = (await client.query<{ id: number }>("INSERT INTO users(username, email, password_hash, role, display_name) VALUES ($1, $1, 'synthetic-rehearsal-unusable-password', 'field_employee', 'Synthetic isolated migration owner') RETURNING id", [marker])).rows[0].id;
    const original = (await client.query("SELECT to_jsonb(u) AS original FROM users u WHERE id = $1", [userId])).rows[0].original;
    const migrationPath = fileURLToPath(new URL("./migrate-assistant-plan-execution.ts", import.meta.url));
    const cwd = fileURLToPath(new URL("../", import.meta.url));
    const migrate = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", migrationPath], { cwd, env: childEnvironment, stdio: "inherit", shell: false });
      child.once("error", reject);
      child.once("exit", (code, signal) => code === 0 && !signal ? resolve() : reject(Error("Owned scratch migration failed")));
    });
    await migrate();
    const first = (await client.query("SELECT to_jsonb(u) - 'assistant_plan_executions' AS original, assistant_plan_executions FROM users u WHERE id = $1", [userId])).rows[0];
    assert.deepEqual(first.original, original, "First application preserves all original user fields");
    assert.equal(first.assistant_plan_executions, null, "Migration must not grant or enable execution for existing users");
    // Deliberately expired and without a real connection, membership or canonical task.
    // This is preservation data, not an executable delegation or manufactured consent.
    const sentinel = [{
      run: createPlanExecution({ id: randomUUID(), requester: { userId, organizationKey: "vendor:1", membershipId: 1, sessionVersion: 1 }, grantReference: "synthetic-rehearsal-not-authority", taskId: randomUUID(), taskVersion: 1, planId: randomUUID(), planVersion: 1, planFingerprint: "a".repeat(64), approvedAt: 1, expiresAt: 60001, maxAttempts: 1, steps: [{ id: "synthetic-read", adapter: "authorized_read", toolName: "list_work_hub_tasks", arguments: {}, dependsOn: [], operationId: randomUUID() }], notificationOperationId: randomUUID() }),
      fence: 0, leaseUntil: 0,
    }];
    await client.query("UPDATE users SET assistant_plan_executions = $2::jsonb WHERE id = $1", [userId, JSON.stringify(sentinel)]);
    await migrate();
    const replayed = (await client.query("SELECT to_jsonb(u) - 'assistant_plan_executions' AS original, assistant_plan_executions FROM users u WHERE id = $1", [userId])).rows[0];
    assert.deepEqual(replayed.original, original, "Replay preserves all original user fields");
    assert.deepEqual(replayed.assistant_plan_executions, sentinel, "Replay preserves existing exact private delegation records");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM users")).rows[0].count, 1);
    const column = (await client.query("SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'assistant_plan_executions'")).rows;
    assert.deepEqual(column, [{ data_type: "jsonb", is_nullable: "YES", column_default: null }]);
    console.log(`PASS: additive first application and replay preserve user and private delegation; retained owned scratch ${target.testDbName}`);
  } finally { await client.end(); }
}

main().catch((error: unknown) => {
  console.error("Assistant plan execution owned-scratch rehearsal failed");
  // Keep database URLs, query parameters and row contents out of CI logs while
  // retaining structural diagnostics for a failed fresh-database rehearsal.
  if (error && typeof error === "object") {
    const source = error as Record<string, unknown>;
    const diagnostic: Record<string, string> = {};
    for (const key of ["name", "code", "table", "column", "constraint", "operator"]) {
      if (typeof source[key] === "string" && /^[A-Za-z0-9_. -]{1,100}$/.test(source[key])) diagnostic[key] = source[key];
    }
    console.error(JSON.stringify(diagnostic));
  }
  process.exitCode = 1;
});
