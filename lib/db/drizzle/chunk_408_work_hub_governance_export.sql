CREATE TABLE IF NOT EXISTS "work_hub_export_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_org_type" text NOT NULL, "owner_org_id" integer NOT NULL,
  "requester_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL, "requester_id_snapshot" text NOT NULL, "requester_display_snapshot" text NOT NULL,
  "request_source" text NOT NULL, "operation_id" uuid NOT NULL, "dataset" text NOT NULL, "format" text NOT NULL, "scope" jsonb NOT NULL, "snapshot_at" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'pending', "attempt_count" integer NOT NULL DEFAULT 0, "available_at" timestamptz NOT NULL DEFAULT now(), "lease_expires_at" timestamptz, "started_at" timestamptz, "finished_at" timestamptz,
  "artifact_storage_key" text, "artifact_file_name" varchar(255), "artifact_content_type" varchar(255), "artifact_sha256" varchar(64), "row_count" bigint, "byte_count" bigint, "generated_at" timestamptz, "expires_at" timestamptz,
  "error_code" varchar(80), "failure_detail" varchar(512), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "work_hub_export_jobs_status_check" CHECK ("status" IN ('pending', 'running', 'completed', 'failed', 'expired')),
  CONSTRAINT "work_hub_export_jobs_counts_check" CHECK ("attempt_count" >= 0 AND ("row_count" IS NULL OR "row_count" >= 0) AND ("byte_count" IS NULL OR "byte_count" >= 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_export_jobs_requester_operation_unique" ON "work_hub_export_jobs" ("requester_id_snapshot", "operation_id");
CREATE INDEX IF NOT EXISTS "work_hub_export_jobs_owner_cursor_idx" ON "work_hub_export_jobs" ("owner_org_type", "owner_org_id", "created_at", "id");
CREATE INDEX IF NOT EXISTS "work_hub_export_jobs_worker_idx" ON "work_hub_export_jobs" ("status", "available_at", "lease_expires_at");
CREATE INDEX IF NOT EXISTS "work_hub_export_jobs_expiry_idx" ON "work_hub_export_jobs" ("expires_at", "status");

CREATE TABLE IF NOT EXISTS "work_hub_retention_minimum_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "policy_version" integer NOT NULL, "rules" jsonb NOT NULL,
  "created_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "work_hub_retention_minimum_version_check" CHECK ("policy_version" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_retention_minimum_policy_version_unique" ON "work_hub_retention_minimum_policies" ("policy_version");

CREATE TABLE IF NOT EXISTS "work_hub_retention_plan_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_org_type" text NOT NULL, "owner_org_id" integer NOT NULL,
  "retention_policy_id" uuid NOT NULL REFERENCES "work_hub_retention_policies"("id"), "policy_version" integer NOT NULL, "minimum_policy_version" integer NOT NULL,
  "requester_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL, "requester_id_snapshot" text NOT NULL, "request_source" text NOT NULL, "operation_id" uuid NOT NULL,
  "snapshot_at" timestamptz NOT NULL, "status" text NOT NULL DEFAULT 'pending', "attempt_count" integer NOT NULL DEFAULT 0, "available_at" timestamptz NOT NULL DEFAULT now(), "lease_expires_at" timestamptz, "started_at" timestamptz, "finished_at" timestamptz,
  "class_aggregates" jsonb NOT NULL, "error_codes" jsonb NOT NULL DEFAULT '[]'::jsonb, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "work_hub_retention_plan_runs_status_check" CHECK ("status" IN ('pending', 'running', 'completed', 'failed') AND "policy_version" > 0 AND "minimum_policy_version" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_retention_plan_runs_requester_operation_unique" ON "work_hub_retention_plan_runs" ("requester_id_snapshot", "operation_id");
CREATE INDEX IF NOT EXISTS "work_hub_retention_plan_runs_owner_cursor_idx" ON "work_hub_retention_plan_runs" ("owner_org_type", "owner_org_id", "created_at", "id");
ALTER TABLE work_hub_retention_plan_runs ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE work_hub_retention_plan_runs ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE work_hub_retention_plan_runs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE work_hub_retention_plan_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS "work_hub_retention_plan_runs_worker_idx" ON "work_hub_retention_plan_runs" ("status", "available_at", "lease_expires_at");

CREATE TABLE IF NOT EXISTS "work_hub_operational_metric_buckets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_org_type" text NOT NULL, "owner_org_id" integer NOT NULL,
  "metric_name" text NOT NULL, "interval_start" timestamptz NOT NULL, "dimensions" jsonb NOT NULL, "dimension_hash" text NOT NULL,
  "count" bigint NOT NULL DEFAULT 0, "sum" double precision NOT NULL DEFAULT 0, "max" double precision NOT NULL DEFAULT 0, "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "work_hub_operational_metric_values_check" CHECK ("count" >= 0 AND "sum" >= 0 AND "max" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_operational_metric_bucket_unique" ON "work_hub_operational_metric_buckets" ("owner_org_type", "owner_org_id", "metric_name", "interval_start", "dimension_hash");
