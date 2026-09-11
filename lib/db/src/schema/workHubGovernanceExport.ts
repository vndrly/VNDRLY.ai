import { sql } from "drizzle-orm";
import { bigint, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubRetentionPoliciesTable } from "./workHubGovernance";

type RetentionPlanAggregate = { eligibleCount: number; eligibleBytes: number; heldCount: number; heldBytes: number; referenceBlockedCount: number; referenceBlockedBytes: number };
type RetentionPlanClass = "messages" | "deleted_messages" | "files_voice_notes" | "notes_versions" | "form_submissions" | "meeting_recordings" | "transcripts" | "attendance" | "external_calendar_cache" | "audit_logs";
type RetentionPlanErrorCode = "policy_unavailable" | "minimum_policy_unavailable" | "policy_changed" | "minimum_policy_changed" | "reference_unresolved" | "owner_context_mismatch" | "lease_expired" | "limit_exceeded" | "internal_failure";
type RetentionPlanClassAggregates = Record<RetentionPlanClass, RetentionPlanAggregate>;

export const workHubExportJobsTable = pgTable("work_hub_export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(), ownerOrgType: text("owner_org_type").notNull(), ownerOrgId: integer("owner_org_id").notNull(),
  requesterUserId: integer("requester_user_id").references(() => usersTable.id, { onDelete: "set null" }), requesterIdSnapshot: text("requester_id_snapshot").notNull(), requesterDisplaySnapshot: text("requester_display_snapshot").notNull(),
  requestSource: text("request_source").notNull(), operationId: uuid("operation_id").notNull(), dataset: text("dataset").notNull(), format: text("format").notNull(), scope: jsonb("scope").$type<Record<string, unknown>>().notNull(), snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"), attemptCount: integer("attempt_count").notNull().default(0), availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), startedAt: timestamp("started_at", { withTimezone: true }), finishedAt: timestamp("finished_at", { withTimezone: true }),
  artifactStorageKey: text("artifact_storage_key"), artifactFileName: varchar("artifact_file_name", { length: 255 }), artifactContentType: varchar("artifact_content_type", { length: 255 }), artifactSha256: varchar("artifact_sha256", { length: 64 }), rowCount: bigint("row_count", { mode: "number" }), byteCount: bigint("byte_count", { mode: "number" }), generatedAt: timestamp("generated_at", { withTimezone: true }), expiresAt: timestamp("expires_at", { withTimezone: true }),
  errorCode: varchar("error_code", { length: 80 }), failureDetail: varchar("failure_detail", { length: 512 }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  requesterOperationUnique: uniqueIndex("work_hub_export_jobs_requester_operation_unique").on(t.requesterIdSnapshot, t.operationId),
  ownerCursorIdx: index("work_hub_export_jobs_owner_cursor_idx").on(t.ownerOrgType, t.ownerOrgId, t.createdAt, t.id),
  workerIdx: index("work_hub_export_jobs_worker_idx").on(t.status, t.availableAt, t.leaseExpiresAt),
  expiryIdx: index("work_hub_export_jobs_expiry_idx").on(t.expiresAt, t.status),
  statusCheck: check("work_hub_export_jobs_status_check", sql`${t.status} in ('pending', 'running', 'completed', 'failed', 'expired')`),
  countsCheck: check("work_hub_export_jobs_counts_check", sql`${t.attemptCount} >= 0 and (${t.rowCount} is null or ${t.rowCount} >= 0) and (${t.byteCount} is null or ${t.byteCount} >= 0)`),
}));

export const workHubRetentionMinimumPoliciesTable = pgTable("work_hub_retention_minimum_policies", {
  id: uuid("id").primaryKey().defaultRandom(), policyVersion: integer("policy_version").notNull(), rules: jsonb("rules").$type<Record<string, number>>().notNull(), createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ policyVersionUnique: uniqueIndex("work_hub_retention_minimum_policy_version_unique").on(t.policyVersion), versionCheck: check("work_hub_retention_minimum_version_check", sql`${t.policyVersion} > 0`) }));

export const workHubRetentionPlanRunsTable = pgTable("work_hub_retention_plan_runs", {
  id: uuid("id").primaryKey().defaultRandom(), ownerOrgType: text("owner_org_type").notNull(), ownerOrgId: integer("owner_org_id").notNull(), retentionPolicyId: uuid("retention_policy_id").notNull().references(() => workHubRetentionPoliciesTable.id), policyVersion: integer("policy_version").notNull(), minimumPolicyVersion: integer("minimum_policy_version").notNull(),
  requesterUserId: integer("requester_user_id").references(() => usersTable.id, { onDelete: "set null" }), requesterIdSnapshot: text("requester_id_snapshot").notNull(), requestSource: text("request_source").notNull(), operationId: uuid("operation_id").notNull(), snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(), status: text("status").notNull().default("pending"), attemptCount: integer("attempt_count").notNull().default(0), availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), startedAt: timestamp("started_at", { withTimezone: true }), finishedAt: timestamp("finished_at", { withTimezone: true }), classAggregates: jsonb("class_aggregates").$type<RetentionPlanClassAggregates>().notNull(), errorCodes: jsonb("error_codes").$type<RetentionPlanErrorCode[]>().notNull().default([]), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ requesterOperationUnique: uniqueIndex("work_hub_retention_plan_runs_requester_operation_unique").on(t.requesterIdSnapshot, t.operationId), ownerCursorIdx: index("work_hub_retention_plan_runs_owner_cursor_idx").on(t.ownerOrgType, t.ownerOrgId, t.createdAt, t.id), workerIdx: index("work_hub_retention_plan_runs_worker_idx").on(t.status, t.availableAt, t.leaseExpiresAt), statusCheck: check("work_hub_retention_plan_runs_status_check", sql`${t.status} in ('pending', 'running', 'completed', 'failed') and ${t.policyVersion} > 0 and ${t.minimumPolicyVersion} > 0`) }));

export const workHubOperationalMetricBucketsTable = pgTable("work_hub_operational_metric_buckets", {
  id: uuid("id").primaryKey().defaultRandom(), ownerOrgType: text("owner_org_type").notNull(), ownerOrgId: integer("owner_org_id").notNull(), metricName: text("metric_name").notNull(), intervalStart: timestamp("interval_start", { withTimezone: true }).notNull(), dimensions: jsonb("dimensions").$type<Record<string, string>>().notNull(), dimensionHash: text("dimension_hash").notNull(), count: bigint("count", { mode: "number" }).notNull().default(0), sum: doublePrecision("sum").notNull().default(0), max: doublePrecision("max").notNull().default(0), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ bucketUnique: uniqueIndex("work_hub_operational_metric_bucket_unique").on(t.ownerOrgType, t.ownerOrgId, t.metricName, t.intervalStart, t.dimensionHash), valuesCheck: check("work_hub_operational_metric_values_check", sql`${t.count} >= 0 and ${t.sum} >= 0 and ${t.max} >= 0`) }));
