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
import { vendorsTable } from "./vendors";

// Audit trail of every admin-initiated vendor merge. The admin "Merge
// into another vendor…" UI writes a row here per (survivor, loser) pair
// so the change is traceable: which vendor was absorbed, when, by whom,
// and exactly how many rows in each FK table moved or were dropped as
// conflicts. The legacy `scripts/dedupe-vendors.ts` batch job shares the
// same FK-rewrite logic but does not write to this table — its activity
// is captured in stdout/exit codes and the SLO is "run once per
// data-quality sweep, by an engineer who already has the receipts."
// (If the batch job ever needs an audit row too, it can call the same
// insert because every column has the script-level info available.)
//
// We capture a small snapshot of the loser vendor (`loserSnapshot`) at the
// moment of merge — name, contact info, logoUrl — because the row is
// deleted from `vendors` immediately after the merge. Without it, an
// audit row two months later would reference a long-gone numeric id with
// no context for the support engineer trying to retrace what happened.
//
// `survivorVendorId` keeps an FK so cascading the survivor away (a rare
// but possible event) sets it null instead of orphaning. `loserVendorId`
// is intentionally NOT an FK — the loser row is gone by definition.
export const vendorMergeAuditLogTable = pgTable(
  "vendor_merge_audit_log",
  {
    id: serial("id").primaryKey(),
    survivorVendorId: integer("survivor_vendor_id").references(
      () => vendorsTable.id,
      { onDelete: "set null" },
    ),
    survivorVendorName: text("survivor_vendor_name").notNull(),
    // No FK — the loser is deleted in the same transaction.
    loserVendorId: integer("loser_vendor_id").notNull(),
    loserVendorName: text("loser_vendor_name").notNull(),
    /** Snapshot of the loser vendor row at merge time (name, contact info,
     *  logoUrl, addresses, tax IDs). Stored as jsonb so the schema can grow
     *  without a migration here. */
    loserSnapshot: jsonb("loser_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    /** Per-table counts: { table_name: { move: N, conflictDelete: N } }.
     *  Mirrors the `MergeCounts` shape returned by `applyMerge` so the
     *  audit row can be displayed as-is in any future "vendor merge
     *  history" UI without re-deriving counts from FK tables. */
    counts: jsonb("counts").$type<Record<string, unknown>>().notNull(),
    /** Per-table primary-key ids that the merge actually moved or
     *  conflict-deleted: `{ table_name: { moved: number[], conflictDeleted: number[] } }`.
     *  Tracked alongside `counts` so the revert endpoint can re-point
     *  the same rows back to the restored loser inside one
     *  transaction (and surface conflict-deleted rows that cannot be
     *  reinstated). Nullable for audit rows written before this
     *  column existed — the revert endpoint treats `null` as "row-id
     *  tracking not available; restore the loser only". */
    movedRowIds:
      jsonb("moved_row_ids").$type<
        Record<string, { moved: number[]; conflictDeleted: number[] }>
      >(),
    totalMoved: integer("total_moved").notNull(),
    totalConflictDeleted: integer("total_conflict_deleted").notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    actorIp: text("actor_ip"),
    actorUserAgent: text("actor_user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Idempotency tracking for the admin "Undo merge" action (Task #830).
    // Set when `POST /admin/vendor-merges/:id/revert` succeeds; a second
    // call against the same audit row short-circuits with
    // `vendor_merge.already_reverted` instead of attempting to restore
    // the loser vendor a second time.
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    revertedByUserId: integer("reverted_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
  },
  (t) => ({
    idxSurvivor: index("vendor_merge_audit_survivor_idx").on(
      t.survivorVendorId,
      t.createdAt,
    ),
    idxCreatedAt: index("vendor_merge_audit_created_idx").on(t.createdAt),
  }),
);

export const insertVendorMergeAuditLogSchema = createInsertSchema(
  vendorMergeAuditLogTable,
).omit({ id: true, createdAt: true });
export type InsertVendorMergeAuditLog = z.infer<
  typeof insertVendorMergeAuditLogSchema
>;
export type VendorMergeAuditLog =
  typeof vendorMergeAuditLogTable.$inferSelect;
