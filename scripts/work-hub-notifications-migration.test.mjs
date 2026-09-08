import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkHubNotificationsMigration } from "./work-hub-notifications-migration.mjs";
test("accepts guarded additive preference columns", () => { assert.equal(validateWorkHubNotificationsMigration('ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "work_hub_messages_enabled" boolean DEFAULT true NOT NULL;').length, 1); });
for (const forbidden of ['DROP TABLE "users"', 'TRUNCATE "users"', 'DELETE FROM "users"', 'ALTER TABLE "users" ADD COLUMN "unguarded" text']) test(`rejects unsafe notification migration: ${forbidden.split(" ")[0]}`, () => { assert.throws(() => validateWorkHubNotificationsMigration(`${forbidden};`)); });
