import assert from "node:assert/strict";
import test from "node:test";
import { DEVICE_CONSENT_MIGRATION, runDeviceConsentMigration } from "../device-consent-migration.mjs";
test("device consent migration only adds one nullable lineage column and verifies it", async () => {
  assert.equal(DEVICE_CONSENT_MIGRATION, 'ALTER TABLE "location_consents" ADD COLUMN IF NOT EXISTS "original_device_id" text');
  const queries = [];
  const client = { query: async sql => { queries.push(sql); return { rows: [{ data_type: "text", is_nullable: "YES" }] }; } };
  await runDeviceConsentMigration(client); await runDeviceConsentMigration(client);
  assert.equal(queries.length, 4);
  assert.equal(queries[0], queries[2]);
  await assert.rejects(runDeviceConsentMigration({ query: async () => ({ rows: [] }) }), /verification failed/);
});
