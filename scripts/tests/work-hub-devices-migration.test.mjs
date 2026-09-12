import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runWorkHubDevicesMigration, validateWorkHubDevicesMigration } from "../work-hub-devices-migration.mjs";

const migrationUrl = new URL("../../lib/db/drizzle/chunk_410_work_hub_devices.sql", import.meta.url);

test("multi-device migration is guarded, additive, and rerunnable", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const statements = validateWorkHubDevicesMigration(migration);
  assert.ok(statements.length >= 12);
  for (const statement of statements) assert.doesNotMatch(statement, /^(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i);
  const executed = [];
  const client = { query: async statement => executed.push(statement) };
  await runWorkHubDevicesMigration(client, migration);
  await runWorkHubDevicesMigration(client, migration);
  assert.deepEqual(executed, [...statements, ...statements]);
});

test("multi-device migration creates every coordination boundary", async () => {
  const sql = validateWorkHubDevicesMigration(await readFile(migrationUrl, "utf8")).join("\n");
  for (const table of ["work_hub_devices", "work_hub_device_connections", "work_hub_workspace_sessions", "work_hub_audio_leases", "work_hub_device_preferences", "work_hub_user_events", "work_hub_meeting_speak_requests"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }
  for (const index of ["work_hub_devices_user_org_idx", "work_hub_device_connections_device_unique", "work_hub_workspace_sessions_user_org_unique", "work_hub_audio_leases_occurrence_user_unique", "work_hub_device_preferences_user_org_unique", "work_hub_user_events_user_org_sequence_idx", "work_hub_user_events_created_at_idx", "work_hub_meeting_speak_requests_pending_unique"]) assert.match(sql, new RegExp(index));
  assert.match(sql, /ALTER TABLE "work_hub_calls" ADD COLUMN IF NOT EXISTS "answered_device_id"/);
  assert.match(sql, /ALTER TABLE "work_hub_calls" ADD COLUMN IF NOT EXISTS "answered_connection_id"/);
});

test("migration validator rejects unsafe or unguarded statements", () => {
  for (const unsafe of ["CREATE TABLE work_hub_bad (id uuid)", "CREATE INDEX work_hub_bad_idx ON work_hub_bad (id)", "DELETE FROM work_hub_devices", "ALTER TABLE work_hub_devices DROP COLUMN friendly_name"]) assert.throws(() => validateWorkHubDevicesMigration(unsafe), /unsafe/i);
});

test("API package and deployment workflow register the device migration", async () => {
  const apiPackage = JSON.parse(await readFile(new URL("../../artifacts/api-server/package.json", import.meta.url), "utf8"));
  assert.equal(apiPackage.scripts["migrate:work-hub-devices"], "node scripts/apply-work-hub-devices-migration.mjs");
  const workflow = await readFile(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
  assert.match(workflow, /run migrate:work-hub-devices/);
});
