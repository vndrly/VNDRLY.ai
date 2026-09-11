import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runWorkHubGovernanceExportMigration,
  validateWorkHubGovernanceExportMigration,
} from "../work-hub-governance-export-migration.mjs";

const migration = await readFile(
  new URL("../../lib/db/drizzle/chunk_408_work_hub_governance_export.sql", import.meta.url),
  "utf8",
);

test("governance export migration is guarded, additive and rerunnable", async () => {
  const statements = validateWorkHubGovernanceExportMigration(migration);
  assert.ok(statements.length >= 12);
  for (const statement of statements) {
    assert.doesNotMatch(statement, /^(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i);
  }

  const executed = [];
  const client = { query: async (statement) => executed.push(statement) };
  await runWorkHubGovernanceExportMigration(client, migration);
  await runWorkHubGovernanceExportMigration(client, migration);
  assert.deepEqual(executed, [...statements, ...statements]);
});

test("governance export migration creates the four required tables and queue/privacy indexes", () => {
  const statements = validateWorkHubGovernanceExportMigration(migration).join("\n");
  for (const table of [
    "work_hub_export_jobs",
    "work_hub_retention_minimum_policies",
    "work_hub_retention_plan_runs",
    "work_hub_operational_metric_buckets",
  ]) assert.match(statements, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));

  for (const indexName of [
    "work_hub_export_jobs_requester_operation_unique",
    "work_hub_export_jobs_owner_cursor_idx",
    "work_hub_export_jobs_worker_idx",
    "work_hub_export_jobs_expiry_idx",
    "work_hub_retention_minimum_policy_version_unique",
    "work_hub_retention_plan_runs_requester_operation_unique",
    "work_hub_retention_plan_runs_worker_idx",
    "work_hub_operational_metric_bucket_unique",
  ]) assert.match(statements, new RegExp(indexName));

  for (const column of [
    "requester_id_snapshot", "requester_display_snapshot", "snapshot_at", "attempt_count", "available_at", "lease_expires_at",
    "artifact_storage_key", "artifact_sha256", "row_count", "byte_count", "expires_at", "failure_detail",
    "minimum_policy_version", "class_aggregates", "error_codes", "dimension_hash",
  ]) assert.match(statements, new RegExp(`"${column}"`));
  for (const constraint of [
    "work_hub_export_jobs_status_check",
    "work_hub_export_jobs_counts_check",
    "work_hub_retention_minimum_version_check",
    "work_hub_retention_plan_runs_status_check",
    "work_hub_operational_metric_values_check",
  ]) assert.match(statements, new RegExp(constraint));
  assert.match(statements, /"failure_detail" varchar\(512\)/);
  assert.match(statements, /"artifact_file_name" varchar\(255\)/);
  assert.match(statements, /"class_aggregates" jsonb NOT NULL/);
  assert.match(statements, /"error_codes" jsonb NOT NULL/);
  assert.match(statements, /ALTER TABLE work_hub_retention_plan_runs ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0/);
  assert.match(statements, /ALTER TABLE work_hub_retention_plan_runs ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(statements, /ALTER TABLE work_hub_retention_plan_runs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz/);
  assert.match(statements, /ALTER TABLE work_hub_retention_plan_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now\(\)/);
});

test("API package and deployment workflow register the guarded migration", async () => {
  const apiPackage = JSON.parse(await readFile(new URL("../../artifacts/api-server/package.json", import.meta.url), "utf8"));
  assert.equal(apiPackage.scripts["migrate:work-hub-governance-export"], "node scripts/apply-work-hub-governance-export-migration.mjs");
  const workflow = await readFile(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
  assert.match(workflow, /run migrate:work-hub-governance-export/);
});

test("migration validator rejects unguarded or data-changing statements", () => {
  for (const unsafe of [
    "CREATE TABLE work_hub_bad (id uuid)",
    "CREATE INDEX work_hub_bad_idx ON work_hub_bad (id)",
    "DELETE FROM work_hub_export_jobs",
    "ALTER TABLE work_hub_export_jobs DROP COLUMN status",
  ]) assert.throws(() => validateWorkHubGovernanceExportMigration(unsafe), /unsafe/i);
});
