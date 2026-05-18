import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";
import { usersTable } from "./users";

// Selectable payment instruments. `partner_marked` was previously used
// to flag payments that the partner self-recorded; that signal now lives
// on `invoice_payments.marked_by_partner` (boolean) so the actual
// instrument is preserved (ach / check / wire / etc). The synthetic
// method has been removed from the selectable list to keep semantics
// unambiguous. Historical rows in the DB may still carry method =
// "partner_marked"; the column is plain text so legacy values remain
// readable.
export const PAYMENT_METHODS = [
  "check",
  "ach",
  "wire",
  "cash",
  "credit_card",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const invoicePaymentsTable = pgTable(
  "invoice_payments",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    referenceNumber: text("reference_number"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    recordedByUserId: integer("recorded_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    // True when the partner self-reported the payment (vs vendor/admin
    // entering it after reconciliation). Used by notification fan-out and
    // ledger labeling. The 'method' column still carries ACH/check/wire/etc
    // even on partner-marked rows so we don't lose the partner's selection.
    markedByPartner: boolean("marked_by_partner").notNull().default(false),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: integer("voided_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    voidedReason: text("voided_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxInvoice: index("invoice_payments_invoice_idx").on(t.invoiceId),
    idxPaidAt: index("invoice_payments_paid_at_idx").on(t.paidAt),
  }),
);

// Append-only audit log for payment lifecycle events (currently 'void';
// future: 'refund', 'reconcile'). One row per event.
export const invoicePaymentAuditLogTable = pgTable(
  "invoice_payment_audit_log",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => invoicePaymentsTable.id, { onDelete: "cascade" }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxPayment: index("invoice_payment_audit_log_payment_idx").on(t.paymentId),
    idxInvoice: index("invoice_payment_audit_log_invoice_idx").on(t.invoiceId),
  }),
);

export type InvoicePaymentAuditLog =
  typeof invoicePaymentAuditLogTable.$inferSelect;

export const insertInvoicePaymentSchema = createInsertSchema(
  invoicePaymentsTable,
).omit({ id: true, createdAt: true });
export type InsertInvoicePayment = z.infer<typeof insertInvoicePaymentSchema>;
export type InvoicePayment = typeof invoicePaymentsTable.$inferSelect;
