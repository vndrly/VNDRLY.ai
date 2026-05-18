import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Audit trail for the admin "Clean up old snapshots" action on the
// `qb_account_mapping_bulk_actions` table. The retention worker fires
// automatically every 24h; admins can also trigger an on-demand sweep
// from the Reports page via
// `POST /reports/qb-account-mapping/bulk-actions/cleanup` (dryRun=false).
//
// Because the cleanup permanently deletes snapshot blobs that back the
// "Undo most recent bulk action" affordance, we record one row here per
// real (non-dryRun) admin invocation so admins can later see who ran the
// cleanup, when, and how many rows were removed — same accountability
// pattern used by the bulk-apply / undo history. Dry-run preview calls
// are NOT recorded (they don't mutate state and would just be noise).
//
// Background-worker sweeps (startup + 24h interval) ARE also recorded
// here, with `actorUserId = NULL` and `actorRole = "system"`, so admins
// have a single complete picture of what removed which snapshots
// (Task #809). The UI renders "system" rows as "System (scheduled)".
// Volume is bounded: at the default 24h interval that's ~365 rows/year,
// well below the on-demand traffic an active deployment generates.
export const qbAccountMappingCleanupAuditTable = pgTable(
  "qb_account_mapping_cleanup_audit",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    // Number of rows physically removed from
    // `qb_account_mapping_bulk_actions` by this invocation. 0 is allowed
    // and meaningful — admins sometimes hit "Clean up" expecting work and
    // we want to record that the action ran even if nothing matched.
    deletedCount: integer("deleted_count").notNull(),
    // Snapshot of how many rows the policy intentionally protected from
    // deletion at the time of the run (the "min retained" floor — the N
    // most-recent rows the cleanup worker keeps regardless of age).
    protectedRecent: integer("protected_recent").notNull(),
    // Resolved retention policy at the time of the run. We snapshot
    // these on the audit row rather than relying on the env-var-derived
    // values at read time so the audit history stays accurate even after
    // an admin tunes `QB_BULK_ACTION_RETENTION_DAYS` /
    // `QB_BULK_ACTION_MIN_RETAINED`.
    retentionDays: integer("retention_days").notNull(),
    minRetained: integer("min_retained").notNull(),
    // Cutoff timestamp the sweep used (`now - retentionDays`). Stored so
    // the UI can show "deleted snapshots older than <date>" without
    // recomputing it from `createdAt - retentionDays` (which would drift
    // if the env var has since been changed).
    cutoff: timestamp("cutoff", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxCreatedAt: index("qb_account_mapping_cleanup_audit_created_idx").on(
      t.createdAt,
    ),
  }),
);

export const insertQbAccountMappingCleanupAuditSchema = createInsertSchema(
  qbAccountMappingCleanupAuditTable,
).omit({ id: true, createdAt: true });
export type InsertQbAccountMappingCleanupAudit = z.infer<
  typeof insertQbAccountMappingCleanupAuditSchema
>;
export type QbAccountMappingCleanupAudit =
  typeof qbAccountMappingCleanupAuditTable.$inferSelect;
