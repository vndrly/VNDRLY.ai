import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkHubCoreMigration } from "./work-hub-core-migration.mjs";

test("accepts only guarded additive core statements", () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS "work_hub_channels" ("id" uuid PRIMARY KEY);
    CREATE INDEX IF NOT EXISTS "work_hub_channels_owner_idx" ON "work_hub_channels" ("id");
  `;
  assert.equal(validateWorkHubCoreMigration(sql).length, 2);
});

for (const forbidden of [
  'DROP TABLE "users"',
  'TRUNCATE "users"',
  'DELETE FROM "users"',
  'CREATE TABLE "unguarded" ("id" integer)',
  'ALTER TABLE "users" ADD COLUMN "unguarded" text',
]) {
  test(`rejects unsafe migration statement: ${forbidden.split(" ")[0]}`, () => {
    assert.throws(() => validateWorkHubCoreMigration(`${forbidden};`));
  });
}
