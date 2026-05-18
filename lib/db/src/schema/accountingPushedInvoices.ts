import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";

// Records every invoice we have already pushed to a remote accounting
// system (QuickBooks Online or OpenAccountant). Used by the
// "Sync to QuickBooks" / "Sync to OpenAccountant" buttons to detect
// re-runs against the same period and skip invoices that were already
// pushed in a previous sync, instead of duplicating them.
//
// Natural key is (vendor_id, provider, invoice_number) — invoice
// numbers are unique within a vendor's books, and "provider" lets us
// independently track QBO and OA pushes for the same invoice.
export const accountingPushedInvoicesTable = pgTable(
  "accounting_pushed_invoices",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // Local invoice number — matches IifInvoice.invoiceNumber.
    invoiceNumber: text("invoice_number").notNull(),
    // Remote system's primary key for the created invoice (QBO Invoice.Id
    // or OA invoice.id). NULL only if the remote did not return one.
    externalInvoiceId: text("external_invoice_id"),
    // What we sent as the remote document number — usually equal to
    // invoice_number, but kept as a separate column so callers can audit
    // what was synced even if the local number is later renumbered.
    externalDocNumber: text("external_doc_number"),
    pushedAt: timestamp("pushed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqVendorProviderInvoice: uniqueIndex(
      "accounting_pushed_invoices_uniq",
    ).on(t.vendorId, t.provider, t.invoiceNumber),
  }),
);

export type AccountingPushedInvoice =
  typeof accountingPushedInvoicesTable.$inferSelect;
