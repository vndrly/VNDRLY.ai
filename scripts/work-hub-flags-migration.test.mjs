import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkHubFlagsMigration, runWorkHubFlagsMigration } from "./work-hub-flags-migration.mjs";

const approved = [
  'ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_enabled" boolean NOT NULL DEFAULT false',
  'ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_meeting_recording_enabled" boolean NOT NULL DEFAULT false',
  'ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_microsoft_365_enabled" boolean NOT NULL DEFAULT false',
  'ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_exports_enabled" boolean NOT NULL DEFAULT false',
];

test("accepts exactly the guarded additive Work Hub flags", () => {
  assert.deepEqual(parseWorkHubFlagsMigration(`${approved.join(";\n")};`), approved);
});

test("rejects destructive or extra statements", () => {
  assert.throws(() => parseWorkHubFlagsMigration(`${approved.join(";\n")}; DROP TABLE users;`));
});

test("runs every approved statement in order", async () => {
  const queries = [];
  await runWorkHubFlagsMigration({ query: async (sql) => queries.push(sql) }, `${approved.join(";\n")};`);
  assert.deepEqual(queries, approved);
});
