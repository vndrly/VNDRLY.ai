import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";
import { partnersTable } from "./partners";
import { invoicesTable } from "./invoices";
import { invoiceLinesTable } from "./invoiceLines";

// Per-line audit trail for the admin-only
// `POST /invoices/backfill-1099-categories` endpoint. The endpoint
// returns aggregate counts by line type, but those aren't enough to
// answer "which draft invoices for vendor X had their equipment lines
// flipped to misc_rents?" after the fact. One row is written here per
// line that the backfill actually mutated, scoped by `runId` so the
// admin UI can list "everything touched by run abc-123".
//
// Why a separate table (rather than reusing
// `qb_account_mapping_audit_log`): that log tracks edits to QB account
// mapping rows, not invoice line income_category. The shapes (mappingId
// vs lineId, accountName vs incomeCategory) and indexing needs are
// different enough that conflating them would obscure both audit
// stories.
//
// `lineId` / `invoiceId` / `vendorId` / `partnerId` use ON DELETE SET
// NULL so the audit history survives a vendor / partner / invoice
// purge — losing the FK target shouldn't blank out an entire run's
// history. The category strings are stored as plain text (mirroring
// the column on `invoice_lines`) so admins can read the row without
// joining an enum table.
export const invoiceLineCategoryBackfillAuditLogTable = pgTable(
  "invoice_line_category_backfill_audit_log",
  {
    id: serial("id").primaryKey(),
    // Groups every audit row produced by a single
    // `POST /invoices/backfill-1099-categories` invocation. The route
    // generates a fresh UUID per call and returns it in the response so
    // the admin UI can immediately deep-link into the per-run detail
    // view without polling.
    runId: uuid("run_id").notNull(),
    lineId: integer("line_id").references(() => invoiceLinesTable.id, {
      onDelete: "set null",
    }),
    invoiceId: integer("invoice_id").references(() => invoicesTable.id, {
      onDelete: "set null",
    }),
    vendorId: integer("vendor_id").references(() => vendorsTable.id, {
      onDelete: "set null",
    }),
    partnerId: integer("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    // Snapshotted at the time of the run, mirroring the `line_type`
    // column on `invoice_lines`. Kept on the row so admins can group
    // the per-run detail view by line type without joining back to
    // `invoice_lines` (which may have changed since the run).
    lineType: text("line_type").notNull(),
    oldIncomeCategory: text("old_income_category").notNull(),
    newIncomeCategory: text("new_income_category").notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Detail view: list every row for a given run, newest first.
    idxRun: index("invoice_line_cat_backfill_audit_run_idx").on(
      t.runId,
      t.id,
    ),
    // Run-list view: distinct runs ordered most-recent-first. Pairing
    // createdAt with runId keeps the DISTINCT scan index-backed.
    idxCreatedAt: index("invoice_line_cat_backfill_audit_created_idx").on(
      t.createdAt,
    ),
    // "Which runs touched vendor X / partner Y" lookup for ad-hoc
    // audit questions ("which draft invoices for vendor X had their
    // equipment lines flipped to misc_rents?" — the motivating example
    // from the task).
    idxVendor: index("invoice_line_cat_backfill_audit_vendor_idx").on(
      t.vendorId,
      t.createdAt,
    ),
    idxPartner: index("invoice_line_cat_backfill_audit_partner_idx").on(
      t.partnerId,
      t.createdAt,
    ),
  }),
);

export const insertInvoiceLineCategoryBackfillAuditLogSchema =
  createInsertSchema(invoiceLineCategoryBackfillAuditLogTable).omit({
    id: true,
    createdAt: true,
  });
export type InsertInvoiceLineCategoryBackfillAuditLog = z.infer<
  typeof insertInvoiceLineCategoryBackfillAuditLogSchema
>;
export type InvoiceLineCategoryBackfillAuditLog =
  typeof invoiceLineCategoryBackfillAuditLogTable.$inferSelect;
