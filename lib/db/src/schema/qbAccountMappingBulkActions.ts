import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Snapshot of a single (vendorId, partnerId, lineType) cell touched by a
// bulk-apply or CSV import. `previous` is null when no override row existed
// before the bulk write (i.e. the bulk write inserted a brand-new row); to
// undo, we delete the current row at that scope. When `previous` is set,
// undo restores the row to those exact values. `applied` is the row the
// bulk write left in place — kept so the UI can summarise what changed and
// so we can detect "no-op undo" if someone re-edits a cell after the bulk.
export interface QbBulkActionSnapshotEntry {
  vendorId: number | null;
  partnerId: number | null;
  lineType: string;
  previous: { accountName: string; accountNumber: string | null } | null;
  applied: { accountName: string; accountNumber: string | null };
}

export const QB_ACCOUNT_MAPPING_BULK_ACTION_KINDS = [
  "bulk_apply",
  "csv_import",
] as const;
export type QbAccountMappingBulkActionKind =
  (typeof QB_ACCOUNT_MAPPING_BULK_ACTION_KINDS)[number];

// Audit table for bulk-apply / CSV-import operations on the
// `qb_account_mapping` table. Each bulk write records a single row here
// containing a snapshot of every (scope, line_type) cell it touched, so an
// admin can later "undo" the entire batch even after a page reload. Single
// PUT/DELETE edits stay in `qb_account_mapping_audit_log` and are NOT
// undoable through this mechanism — those are intentionally point edits and
// not bulk operations.
export const qbAccountMappingBulkActionsTable = pgTable(
  "qb_account_mapping_bulk_actions",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    // Optional human-readable label (e.g. "12 vendors × 3 line types" or
    // "qb-mapping.csv (47 rows)") so the UI can show what the action was
    // without parsing the snapshot blob.
    summary: text("summary").notNull(),
    // Per-cell snapshot — see QbBulkActionSnapshotEntry.
    snapshots: jsonb("snapshots")
      .$type<QbBulkActionSnapshotEntry[]>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // When set, this action has been undone and should no longer offer
    // an undo button. We never delete the row so the timeline stays
    // visible to admins who want to audit "we undid this batch at 4pm".
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneByUserId: integer("undone_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    // Stamped by the expiry-warning worker the first time it processes this
    // row (regardless of whether the actor's preferences resulted in an
    // in-app notify, an email, both, or neither). Acts as a per-row dedup
    // marker so the worker doesn't re-attempt the same row on every 24h
    // sweep — important now that "email only" / "off" preferences exist
    // (where the existing notifications-table dedupeKey is no longer the
    // sole record of "we already considered this row"). Nullable so rows
    // that never enter the warning band (deleted by retention before then)
    // don't carry a noisy timestamp.
    expiryWarningProcessedAt: timestamp("expiry_warning_processed_at", {
      withTimezone: true,
    }),
  },
  (t) => ({
    idxCreatedAt: index("qb_account_mapping_bulk_actions_created_idx").on(
      t.createdAt,
    ),
  }),
);

export const insertQbAccountMappingBulkActionSchema = createInsertSchema(
  qbAccountMappingBulkActionsTable,
).omit({ id: true, createdAt: true, undoneAt: true, undoneByUserId: true });
export type InsertQbAccountMappingBulkAction = z.infer<
  typeof insertQbAccountMappingBulkActionSchema
>;
export type QbAccountMappingBulkAction =
  typeof qbAccountMappingBulkActionsTable.$inferSelect;
