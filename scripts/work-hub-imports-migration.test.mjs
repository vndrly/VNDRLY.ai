import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkHubImportsMigration } from "./work-hub-imports-migration.mjs";

test("Work Hub imports migration allows additive tables and indexes", () => {
  assert.equal(
    validateWorkHubImportsMigration(
      "CREATE TABLE IF NOT EXISTS x (id uuid); CREATE INDEX IF NOT EXISTS y ON x(id);",
    ).length,
    2,
  );
});

test("Work Hub imports migration rejects destructive statements", () => {
  assert.throws(
    () => validateWorkHubImportsMigration("DROP TABLE users;"),
    /Unsafe/,
  );
});
