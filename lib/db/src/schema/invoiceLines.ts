import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";
import { ticketsTable } from "./tickets";

export const invoiceLinesTable = pgTable(
  "invoice_lines",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    ticketId: integer("ticket_id").references(() => ticketsTable.id, {
      onDelete: "set null",
    }),
    sourceType: text("source_type").notNull(),
    sourceId: integer("source_id"),
    afe: text("afe"),
    lineType: text("line_type").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
    unit: text("unit"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 4 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    taxable: boolean("taxable").notNull().default(true),
    taxState: text("tax_state"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 4 }),
    taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    isManualOverride: boolean("is_manual_override").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    // 1099 income category. Drives which form box the line lands in at year
    // end: 'nec' = 1099-NEC Box 1 (default for labor), 'misc_*' values map
    // to 1099-MISC boxes, 'k_third_party_network' means the payment was
    // through a TPSO and is reported via the 1099-K instead. 'none' suppresses
    // 1099 reporting entirely (e.g. reimbursements). Default 'nec' preserves
    // existing report behavior for historical rows.
    incomeCategory: text("income_category").notNull().default("nec"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    idxInvoice: index("invoice_lines_invoice_idx").on(t.invoiceId),
    idxTicket: index("invoice_lines_ticket_idx").on(t.ticketId),
    idxSource: index("invoice_lines_source_idx").on(t.sourceType, t.sourceId),
    // Belt-and-suspenders dedupe for generated (non-manual) lines: at most
    // ONE generated row per (invoice, ticket, sourceType, sourceId). The
    // primary cluster-wide protection is a Postgres advisory lock in the
    // invoice generator; these row-level guarantees catch any future bug
    // (lock-key drift, callsite that bypasses the generator, etc.) that
    // would otherwise insert duplicate lines and double-bill the customer.
    //
    // - Restricted to is_manual_override=false so user-edited lines and
    //   their generator counterparts (suppressed by the orchestrator's
    //   overrideKeys filter) coexist freely.
    // - Split into two partial indexes (one for sources with a row id,
    //   one for sources without) instead of a single COALESCE expression,
    //   because Postgres' default NULLS-DISTINCT semantics would let two
    //   NULL-sourceId rows coexist AND drizzle-kit cannot reliably diff
    //   COALESCE expressions in indexes (every push reports drift).
    //
    // First index: sources WITH a concrete source_id (check_in_labor,
    // check_in_overtime, ticket_line_item) — Postgres' default
    // (col1, col2, col3, col4) uniqueness with no NULLs catches dupes.
    uniqGeneratedDedupe: uniqueIndex(
      "invoice_lines_generated_dedupe_uniq",
    )
      .on(t.invoiceId, t.ticketId, t.sourceType, t.sourceId)
      .where(
        sql`is_manual_override = false AND ticket_id IS NOT NULL AND source_id IS NOT NULL`,
      ),
    // Second index: generated sources with NULL source_id (currently
    // mileage_auto). At most one row per (invoice, ticket, sourceType).
    uniqGeneratedDedupeNullSource: uniqueIndex(
      "invoice_lines_generated_dedupe_null_source_uniq",
    )
      .on(t.invoiceId, t.ticketId, t.sourceType)
      .where(
        sql`is_manual_override = false AND ticket_id IS NOT NULL AND source_id IS NULL`,
      ),
  }),
);

export const INVOICE_LINE_TYPES = [
  "labor_regular",
  "labor_overtime",
  "equipment",
  "materials",
  "mileage",
  "per_diem",
  "markup",
  "discount",
  "other",
] as const;
export type InvoiceLineType = (typeof INVOICE_LINE_TYPES)[number];

// 1099 income categories. NEC is the default and matches existing data.
// 1099-MISC boxes map to specific values. k_third_party_network is for
// payments processed by a third-party settlement organization (1099-K).
// 'none' suppresses 1099 reporting (e.g. reimbursements, returns of capital).
export const INVOICE_LINE_INCOME_CATEGORIES = [
  "nec",
  "misc_rents",
  "misc_royalties",
  "misc_other_income",
  "misc_prizes_awards",
  "misc_medical_health",
  "misc_attorney",
  "k_third_party_network",
  "none",
] as const;
export type InvoiceLineIncomeCategory =
  (typeof INVOICE_LINE_INCOME_CATEGORIES)[number];

// Locales for which 1099 category labels are localized on the rendered
// invoice PDF. Mirrors the locales the partner billing flow can resolve
// via `resolveBillingLocale` on the server. Keep in sync if a new locale
// is added there.
export const INVOICE_LINE_INCOME_CATEGORY_LOCALES = ["en", "es"] as const;
export type InvoiceLineIncomeCategoryLocale =
  (typeof INVOICE_LINE_INCOME_CATEGORY_LOCALES)[number];

// Human-readable labels for each 1099 income category, by locale. Mirrors
// the `invoices.incomeCategory.*` translations in the web client's
// en.json / es.json so the same label appears on the in-app screen, the
// rendered PDF, and the memo lines of accounting exports. Keep in sync
// when adding categories or locales.
//
// IIF/CSV exports always use the English labels (US tax/accountant-facing
// artifacts); only the partner-facing PDF localizes.
export const INVOICE_LINE_INCOME_CATEGORY_LABELS_BY_LOCALE: Record<
  InvoiceLineIncomeCategoryLocale,
  Record<InvoiceLineIncomeCategory, string>
> = {
  en: {
    nec: "Service – 1099-NEC",
    misc_rents: "Rent – 1099-MISC Box 1",
    misc_royalties: "Royalties – 1099-MISC Box 2",
    misc_other_income: "Other income – 1099-MISC Box 3",
    misc_prizes_awards: "Prizes & awards – 1099-MISC Box 3",
    misc_medical_health: "Medical & health – 1099-MISC Box 6",
    misc_attorney: "Attorney fees – 1099-MISC Box 10",
    k_third_party_network: "Card / third-party network – 1099-K",
    none: "Not reportable",
  },
  es: {
    nec: "Servicio – 1099-NEC",
    misc_rents: "Renta – 1099-MISC casilla 1",
    misc_royalties: "Regalías – 1099-MISC casilla 2",
    misc_other_income: "Otros ingresos – 1099-MISC casilla 3",
    misc_prizes_awards: "Premios y galardones – 1099-MISC casilla 3",
    misc_medical_health: "Médico y salud – 1099-MISC casilla 6",
    misc_attorney: "Honorarios de abogado – 1099-MISC casilla 10",
    k_third_party_network: "Tarjeta / red de terceros – 1099-K",
    none: "No declarable",
  },
};

// Back-compat alias — existing callers (IIF/CSV exports) imported the
// English-only map. Preserved so accountant-facing artifacts keep their
// US-tax wording without code changes.
export const INVOICE_LINE_INCOME_CATEGORY_LABELS =
  INVOICE_LINE_INCOME_CATEGORY_LABELS_BY_LOCALE.en;

/** Returns the human label for a 1099 category key in the given locale,
 *  or the raw key as a fallback if the value isn't a known category
 *  (defensive for legacy data). Defaults to English so existing English-
 *  only callers (IIF/CSV exports, server-side preview) keep their
 *  current behavior. */
export function incomeCategoryLabel(
  cat: string | null | undefined,
  locale: InvoiceLineIncomeCategoryLocale = "en",
): string {
  const table =
    INVOICE_LINE_INCOME_CATEGORY_LABELS_BY_LOCALE[locale] ??
    INVOICE_LINE_INCOME_CATEGORY_LABELS_BY_LOCALE.en;
  if (!cat) return table.nec;
  return table[cat as InvoiceLineIncomeCategory] ?? cat;
}

export const INVOICE_LINE_SOURCES = [
  "check_in_labor",
  "check_in_overtime",
  "ticket_line_item",
  "mileage_auto",
  "manual",
] as const;
export type InvoiceLineSource = (typeof INVOICE_LINE_SOURCES)[number];

export const insertInvoiceLineSchema = createInsertSchema(invoiceLinesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInvoiceLine = z.infer<typeof insertInvoiceLineSchema>;
export type InvoiceLine = typeof invoiceLinesTable.$inferSelect;
