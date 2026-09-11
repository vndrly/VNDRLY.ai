import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runWorkHubMeetingReplayMigration,
  validateWorkHubMeetingReplayMigration,
} from "../work-hub-meeting-replay-migration.mjs";

const migration = await readFile(new URL("../../lib/db/drizzle/chunk_409_work_hub_meeting_replay.sql", import.meta.url), "utf8");

test("meeting replay migration is guarded, additive, rerunnable, and has no retention deletion", async () => {
  const statements = validateWorkHubMeetingReplayMigration(migration);
  assert.ok(statements.length >= 8);
  for (const statement of statements) assert.doesNotMatch(statement, /^(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i);
  assert.doesNotMatch(migration, /(?:^|[^a-z_])expires_at|delete_at|retention_days/i);
  const executed = [];
  const client = { query: async (statement) => executed.push(statement) };
  await runWorkHubMeetingReplayMigration(client, migration);
  await runWorkHubMeetingReplayMigration(client, migration);
  assert.deepEqual(executed, [...statements, ...statements]);
});

test("meeting replay migration creates privacy, idempotency, sequence, and timing constraints", () => {
  const sql = validateWorkHubMeetingReplayMigration(migration).join("\n");
  for (const table of ["work_hub_meeting_replay_manifests", "work_hub_meeting_replay_audio_chunks", "work_hub_meeting_replay_events", "work_hub_meeting_replay_assignments"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }
  for (const index of [
    "work_hub_meeting_replay_manifest_occurrence_unique",
    "work_hub_meeting_replay_chunk_operation_unique",
    "work_hub_meeting_replay_chunk_sequence_unique",
    "work_hub_meeting_replay_event_operation_unique",
    "work_hub_meeting_replay_event_key_unique",
    "work_hub_meeting_replay_event_timeline_idx",
    "work_hub_meeting_replay_assignment_unique",
    "work_hub_meeting_replay_assignment_assignee_idx",
  ]) assert.match(sql, new RegExp(index));
  for (const constraint of [
    "work_hub_meeting_replay_manifest_status_check",
    "work_hub_meeting_replay_manifest_values_check",
    "work_hub_meeting_replay_chunk_state_check",
    "work_hub_meeting_replay_chunk_values_check",
    "work_hub_meeting_replay_event_type_check",
    "work_hub_meeting_replay_event_values_check",
    "work_hub_meeting_replay_assignment_requirement_check",
    "work_hub_meeting_replay_assignment_status_check",
    "work_hub_meeting_replay_assignment_values_check",
  ]) assert.match(sql, new RegExp(constraint));
  assert.match(sql, /REFERENCES "work_hub_meeting_occurrences"\("id"\)(?! ON DELETE CASCADE)/);
  for (const column of ["duration_ms", "sample_rate", "channel_count", "bits_per_sample", "sample_count", "recording_lease_generation", "recording_lease_token_hash", "recording_lease_holder_user_id", "recording_lease_issued_at", "recording_lease_expires_at", "lease_generation"]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS "${column}"`));
  }
});

test("migration validator rejects unguarded or data-changing statements", () => {
  for (const unsafe of [
    "CREATE TABLE work_hub_bad (id uuid)",
    "CREATE INDEX work_hub_bad_idx ON work_hub_bad (id)",
    "DELETE FROM work_hub_meeting_replay_audio_chunks",
    "ALTER TABLE work_hub_meeting_replay_manifests DROP COLUMN status",
  ]) assert.throws(() => validateWorkHubMeetingReplayMigration(unsafe), /unsafe/i);
});

test("API package and deployment workflow register the guarded replay migration", async () => {
  const apiPackage = JSON.parse(await readFile(new URL("../../artifacts/api-server/package.json", import.meta.url), "utf8"));
  assert.equal(apiPackage.scripts["migrate:work-hub-meeting-replay"], "node scripts/apply-work-hub-meeting-replay-migration.mjs");
  const workflow = await readFile(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
  assert.match(workflow, /run migrate:work-hub-meeting-replay/);
});
