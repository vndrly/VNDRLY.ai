import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { partnersTable } from "./partners";

// Late-fee policy persisted on the invoice. The engine doesn't apply it yet
// (Phase 3), but the field is shaped now so consumers don't pass `any`.
export type LateFeeRule =
  | { kind: "flat"; amount: string; afterDays: number }
  | { kind: "percent"; rate: string; afterDays: number; compounding?: "none" | "monthly" }
  | { kind: "none" };

export const invoicesTable = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    invoiceNumber: text("invoice_number").notNull(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "restrict" }),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    cadence: text("cadence").notNull(),
    status: text("status").notNull().default("draft"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    paymentTermsDays: integer("payment_terms_days"),
    remitToAddress: text("remit_to_address"),
    remitToName: text("remit_to_name"),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
    // Phase 3 balance tracking. Updated atomically with payment / credit memo
    // writes. balance_due is computed at read time as
    // total - paid_amount - credited_amount.
    paidAmount: numeric("paid_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    creditedAmount: numeric("credited_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    // Cached billing recipient at time of send so reminders don't break if
    // the partner contact list changes after the original send.
    billingContactEmail: text("billing_contact_email"),
    notes: text("notes"),
    supplementalOfInvoiceId: integer("supplemental_of_invoice_id"),
    lateFeeRule: jsonb("late_fee_rule").$type<LateFeeRule | null>(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeChargeId: text("stripe_charge_id"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    lastRecomputedAt: timestamp("last_recomputed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqInvoiceNumber: uniqueIndex("invoices_invoice_number_unique").on(t.invoiceNumber),
    idxVendorStatus: index("invoices_vendor_status_idx").on(t.vendorId, t.status),
    idxPartnerStatus: index("invoices_partner_status_idx").on(t.partnerId, t.status),
    idxOpenPeriod: index("invoices_open_period_idx").on(
      t.vendorId,
      t.partnerId,
      t.cadence,
      t.status,
      t.periodStart,
    ),
    // Concurrency guard: at most one ROOT (non-supplemental) draft invoice
    // per (vendor, partner, cadence, periodStart). Supplemental drafts are
    // allowed to coexist (one per parent) and are excluded from this guard.
    // per_ticket is excluded — that cadence intentionally creates a new
    // invoice per approved ticket and is uniqueness-guarded via
    // invoice_ticket_links instead.
    uniqDraftPerPeriod: uniqueIndex("invoices_unique_draft_per_period")
      .on(t.vendorId, t.partnerId, t.cadence, t.periodStart)
      .where(
        sql`status = 'draft' AND supplemental_of_invoice_id IS NULL AND cadence <> 'per_ticket'`,
      ),
    // Concurrency guard for supplementals: at most one open draft supplemental
    // per (vendor, partner, cadence, periodStart, parent). Without this,
    // concurrent generators for different tickets in a period whose root
    // invoice has already been sent could each create their own supplemental
    // draft, forking charges. per_ticket excluded for the same reason as
    // above.
    uniqSupplementalDraftPerPeriod: uniqueIndex(
      "invoices_unique_supplemental_draft_per_period",
    )
      .on(
        t.vendorId,
        t.partnerId,
        t.cadence,
        t.periodStart,
        t.supplementalOfInvoiceId,
      )
      .where(
        sql`status = 'draft' AND supplemental_of_invoice_id IS NOT NULL AND cadence <> 'per_ticket'`,
      ),
  }),
);

export const INVOICE_STATUSES = [
  "draft",
  "open",
  "sent",
  "paid",
  "overdue",
  "cancelled",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
