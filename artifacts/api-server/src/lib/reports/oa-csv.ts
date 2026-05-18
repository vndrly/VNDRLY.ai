// OpenAccountant CSV import bundle.
//
// OA's importer accepts column-named CSVs without a strict template — we
// emit a generic three-CSV layout (customers / vendors / invoices) plus a
// README documenting the field semantics. Column names use OA's documented
// conventions; downstream users can rename via OA's column-mapper.

import { incomeCategoryLabel } from "@workspace/db";
import { toCsv, type CsvCell } from "./csv";
import type {
  IifInvoice,
  IifInvoiceLine,
  IifPartner,
  IifVendor,
} from "./iif";

function fmtIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function oaCustomersCsv(partners: IifPartner[]): string {
  const headers = ["customer_name", "email", "address"];
  const rows: CsvCell[][] = partners.map((p) => [
    p.name,
    p.email ?? "",
    p.address ?? "",
  ]);
  return toCsv(headers, rows);
}

export function oaVendorsCsv(vendors: IifVendor[]): string {
  const headers = ["vendor_name", "email", "address", "federal_tax_id"];
  const rows: CsvCell[][] = vendors.map((v) => [
    v.name,
    v.email ?? "",
    v.address ?? "",
    v.federalTaxId ?? "",
  ]);
  return toCsv(headers, rows);
}

export function oaInvoicesCsv(
  invoices: IifInvoice[],
  lines: IifInvoiceLine[],
): string {
  const headers = [
    "invoice_number",
    "customer_name",
    "invoice_date",
    "due_date",
    "line_type",
    "line_description",
    "line_amount",
    "line_tax_amount",
    "invoice_subtotal",
    "invoice_tax_total",
    "invoice_total",
    "memo",
    // 1099 columns. The raw key (`income_category`) drives OA's mapping rules
    // and the human label (`income_category_label`) is for accountants
    // eyeballing the CSV directly.
    "income_category",
    "income_category_label",
  ];
  const linesByInv = new Map<string, IifInvoiceLine[]>();
  for (const l of lines) {
    const arr = linesByInv.get(l.invoiceNumber) ?? [];
    arr.push(l);
    linesByInv.set(l.invoiceNumber, arr);
  }
  const rows: CsvCell[][] = [];
  for (const inv of invoices) {
    const ls = linesByInv.get(inv.invoiceNumber) ?? [];
    for (const l of ls) {
      const cat = l.incomeCategory ?? "";
      // Mirror the IIF / QBO behavior: append the "[1099: <label>]" tag to
      // the memo so the classification survives a round-trip even when the
      // OA column-mapper doesn't pick up the dedicated income_category
      // columns. Suppressed for the empty / "none" cases.
      const tagged = cat && cat !== "none"
        ? `${inv.memo ?? ""} [1099: ${incomeCategoryLabel(cat)}]`.trim()
        : inv.memo ?? "";
      rows.push([
        inv.invoiceNumber,
        inv.partnerName,
        fmtIso(inv.invoiceDate),
        inv.dueDate ? fmtIso(inv.dueDate) : "",
        l.lineType,
        l.description,
        Number(l.amount).toFixed(2),
        Number(l.taxAmount).toFixed(2),
        Number(inv.subtotal).toFixed(2),
        Number(inv.taxTotal).toFixed(2),
        Number(inv.total).toFixed(2),
        tagged,
        cat,
        cat ? incomeCategoryLabel(cat) : "",
      ]);
    }
  }
  return toCsv(headers, rows);
}

export function readmeOa(periodLabel: string, vendorName: string): string {
  return [
    `VNDRLY → OpenAccountant Import Bundle`,
    `=====================================`,
    ``,
    `Vendor: ${vendorName}`,
    `Period: ${periodLabel}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Files:`,
    `  customers.csv  - One row per customer/partner.`,
    `  vendors.csv    - One row per vendor (the seller).`,
    `  invoices.csv   - One row per invoice line; invoice header repeats.`,
    ``,
    `OA's import wizard will let you map these columns to its internal`,
    `schema. All amounts are decimal with 2dp; dates are ISO-8601 (YYYY-MM-DD).`,
    ``,
    `1099 INCOME CATEGORY: invoices.csv now carries two columns —`,
    `  income_category        machine key (e.g. "nec", "misc_attorney")`,
    `  income_category_label  human label (e.g. "Service – 1099-NEC")`,
    `Map income_category to your OA tax-classification field; the label is`,
    `provided so the CSV is readable when opened directly in a spreadsheet.`,
    ``,
  ].join("\r\n");
}
