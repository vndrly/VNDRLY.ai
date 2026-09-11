import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../lib/db/drizzle/chunk_402_work_hub_meeting_collaboration.sql", import.meta.url), "utf8");
const runner = await readFile(new URL("../../artifacts/api-server/scripts/apply-work-hub-meeting-collaboration-migration.mjs", import.meta.url), "utf8");

test("meeting collaboration runner resolves the migration inside the repository", () => {
  assert.match(
    runner,
    /new URL\("\.\.\/\.\.\/\.\.\/lib\/db\/drizzle\/chunk_402_work_hub_meeting_collaboration\.sql"/,
  );
  assert.doesNotMatch(runner, /\.\.\/\.\.\/\.\.\/\.\.\/lib\/db\/drizzle/);
});

test("meeting collaboration migration is additive and guarded", () => {
  const statements = migration.split(";").map((value) => value.trim()).filter(Boolean);
  assert.ok(statements.length >= 7);
  for (const statement of statements) {
    assert.match(statement, /^ALTER TABLE [a-z_]+ ADD COLUMN IF NOT EXISTS /i);
    assert.doesNotMatch(statement, /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  }
});

test("meeting collaboration migration includes private, file, removal and Ask V state", () => {
  for (const column of ["recipient_user_id", "message_type", "attachment", "removed_at", "removed_by_id", "askv_invited_at", "askv_invited_by_id"]) {
    assert.match(migration, new RegExp(column));
  }
});
