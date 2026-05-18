import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
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

// Per-line audit trail for any bulk 1099-category change made through the
// admin / finance-facing endpoints:
//
//   bulk_set            — PATCH /invoices/:id/lines (single-invoice bulk
//                         recategorize, the per-row "Apply to N lines" UX).
//   vendor_recategorize — POST /invoices/bulk-recategorize-1099 (vendor-
//                         scoped year-end cleanup from the 1099 dashboard).
//   undo                — Either of the two undo paths: PATCH …/lines with
//                         the per-line `updates` shape, or POST
//                         /invoices/restore-1099-categories.
//
// Why a dedicated table (rather than reusing
// `invoice_line_category_backfill_audit_log`): that table tracks the
// admin-only one-shot backfill that re-derives engine-owned categories
// from line_type. The bulk / undo paths are a *different* user action with
// different ownership semantics (they always set is_manual_override) and
// the report the accountant needs to read is "who flipped this vendor's
// lines and when", not "what did the backfill touch in run X". Keeping
// them separate avoids overloading either audit story.
//
// FK columns use ON DELETE SET NULL so the audit history survives a vendor
// / partner / invoice / line / user purge. The category columns are stored
// as plain text mirroring `invoice_lines.income_category` so an admin can
// read the row without joining an enum table, and the manual-override
// flags are captured both before and after so an undo row truly reflects
// the prior state being restored.
export const INVOICE_LINE_CATEGORY_AUDIT_ACTIONS = [
  "bulk_set",
  "undo",
  "vendor_recategorize",
] as const;
export type InvoiceLineCategoryAuditAction =
  (typeof INVOICE_LINE_CATEGORY_AUDIT_ACTIONS)[number];

export const invoiceLineCategoryAuditTable = pgTable(
  "invoice_line_category_audit",
  {
    id: serial("id").primaryKey(),
    // Groups every row written by a single endpoint invocation (one PATCH
    // / POST → one batchId). Lets the dashboard collapse "admin X flipped
    // 5 lines from NEC to MISC" into one entry instead of five.
    batchId: uuid("batch_id").notNull(),
    action: text("action").notNull(),
    invoiceId: integer("invoice_id").references(() => invoicesTable.id, {
      onDelete: "set null",
    }),
    lineId: integer("line_id").references(() => invoiceLinesTable.id, {
      onDelete: "set null",
    }),
    vendorId: integer("vendor_id").references(() => vendorsTable.id, {
      onDelete: "set null",
    }),
    partnerId: integer("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    priorIncomeCategory: text("prior_income_category").notNull(),
    priorIsManualOverride: boolean("prior_is_manual_override").notNull(),
    newIncomeCategory: text("new_income_category").notNull(),
    newIsManualOverride: boolean("new_is_manual_override").notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // "Show recent category changes for vendor X (year Y)" — the
    // dashboard view filters by vendorId and bounds by createdAt, so the
    // composite index is exactly what that query needs.
    idxVendor: index("invoice_line_cat_audit_vendor_idx").on(
      t.vendorId,
      t.createdAt,
    ),
    idxPartner: index("invoice_line_cat_audit_partner_idx").on(
      t.partnerId,
      t.createdAt,
    ),
    // Newest-first global feed (admin-scope dashboard / pagination).
    idxCreatedAt: index("invoice_line_cat_audit_created_idx").on(t.createdAt),
    // Group-collapse by batch: every action's rows share a batchId.
    idxBatch: index("invoice_line_cat_audit_batch_idx").on(t.batchId),
  }),
);

export const insertInvoiceLineCategoryAuditSchema = createInsertSchema(
  invoiceLineCategoryAuditTable,
).omit({ id: true, createdAt: true });
export type InsertInvoiceLineCategoryAudit = z.infer<
  typeof insertInvoiceLineCategoryAuditSchema
>;
export type InvoiceLineCategoryAudit =
  typeof invoiceLineCategoryAuditTable.$inferSelect;
