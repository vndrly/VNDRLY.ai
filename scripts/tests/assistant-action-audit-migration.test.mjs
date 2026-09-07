import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseAssistantActionAuditMigration, runAssistantActionAuditMigration } from "../assistant-action-audit-migration.mjs";

const sql = await readFile(new URL("../../lib/db/drizzle/chunk_388_assistant_action_audit.sql", import.meta.url), "utf8");

test("accepts only the existing audit table and three idempotent indexes", () => {
  const statements = parseAssistantActionAuditMigration(sql);
  assert.equal(statements.length, 4);
  assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS "assistant_action_audit"/);
  assert.ok(statements.slice(1).every(statement => statement.startsWith("CREATE INDEX IF NOT EXISTS")));
  assert.deepEqual(parseAssistantActionAuditMigration(sql.replaceAll("\n", "\r\n")), statements);
});

test("rejects additional SQL, target changes, destructive changes and altered column definitions before querying", async () => {
  for (const changed of [sql + '; DROP TABLE users;', sql + '; SELECT 1;', sql.replace('"assistant_action_audit"', '"other_table"'),
    sql.replace('"transcript_text" text', '"transcript_text" integer'), sql.replace('ON DELETE set null', 'ON DELETE cascade')]) {
    const calls = [];
    await assert.rejects(runAssistantActionAuditMigration({ query: async query => { calls.push(query); return { rows: [] }; } }, changed), /exactly the approved/);
    assert.equal(calls.length, 0);
  }
});

test("secures the table and sequence inside the creation transaction and rolls back schema mismatch", async () => {
  const calls = [];
  const client = { query: async query => { calls.push(query); return { rows: query.startsWith("SELECT rolname") ? [{ rolname: "anon" }, { rolname: "authenticated" }] : [] }; } };
  await assert.rejects(runAssistantActionAuditMigration(client, sql), /column preflight failed/);
  assert.equal(calls[0], "BEGIN");
  assert.ok(calls.includes('ALTER TABLE public."assistant_action_audit" ENABLE ROW LEVEL SECURITY'));
  assert.ok(calls.includes('REVOKE ALL ON TABLE public."assistant_action_audit" FROM PUBLIC, "anon", "authenticated"'));
  assert.ok(calls.includes('REVOKE ALL ON SEQUENCE public."assistant_action_audit_id_seq" FROM PUBLIC, "anon", "authenticated"'));
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(!calls.includes("COMMIT"));
});

test("deployment paths include the audit migration before greeting and restart", async () => {
  const { buildApiMigrationAndRestartCommands } = await import("../plate-state-migration.mjs");
  const workflow = await readFile(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
  for (const commands of [buildApiMigrationAndRestartCommands(), workflow]) {
    const audit = commands.indexOf("migrate:assistant-action-audit");
    assert.ok(audit >= 0, "deployment must create the missing audit prerequisite");
    assert.ok(audit < commands.indexOf("migrate:askv-greeting"));
    assert.ok(audit < commands.indexOf("systemctl restart vndrly-api"));
  }
});
