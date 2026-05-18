// QuickBooks Online CSV import bundle.
//
// QBO's "Import Customers / Vendors / Invoices" wizards each accept a CSV
// with column headers it recognizes. This module emits three CSVs zipped
// together (with a README) for one-shot import.
//
// Reference column names match QBO's "Import Data" template downloadable
// from Settings → Tools → Import Data; we pick the minimum required set
// plus optional address/email so a fresh import succeeds without further
// mapping.

import { incomeCategoryLabel } from "@workspace/db";
import { toCsv, type CsvCell } from "./csv";
import type {
  IifInvoice,
  IifInvoiceLine,
  IifPartner,
  IifVendor,
} from "./iif";
import { defaultResolver, type QbAccountResolver } from "./qb-mapping";

/** Returns the per-line memo with a "[1099: <label>]" suffix so the income
 *  category survives import into QBO (which has no dedicated 1099-box field
 *  on the invoice line). Suppressed for "none" / missing values. */
function memoWith1099Tag(
  description: string,
  incomeCategory: string | null | undefined,
): string {
  if (!incomeCategory || incomeCategory === "none") return description;
  return `${description} [1099: ${incomeCategoryLabel(incomeCategory)}]`;
}

function fmtCsvDate(d: Date): string {
  // QBO accepts MM/DD/YYYY for US locale imports.
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${m}/${day}/${d.getUTCFullYear()}`;
}

export function customersCsv(partners: IifPartner[]): string {
  const headers = [
    "Customer",
    "Email",
    "Billing Street",
    "Billing City",
    "Billing State",
    "Billing ZIP",
  ];
  // We only have a single free-text address — drop it into Billing Street.
  const rows: CsvCell[][] = partners.map((p) => [
    p.name,
    p.email ?? "",
    p.address ?? "",
    "",
    "",
    "",
  ]);
  return toCsv(headers, rows);
}

export function vendorsCsv(vendors: IifVendor[]): string {
  const headers = [
    "Vendor",
    "Email",
    "Billing Street",
    "Billing City",
    "Billing State",
    "Billing ZIP",
    "Tax ID",
  ];
  const rows: CsvCell[][] = vendors.map((v) => [
    v.name,
    v.email ?? "",
    v.address ?? "",
    "",
    "",
    "",
    v.federalTaxId ?? "",
  ]);
  return toCsv(headers, rows);
}

export function invoicesCsv(
  invoices: IifInvoice[],
  lines: IifInvoiceLine[],
  resolver: QbAccountResolver = defaultResolver,
): string {
  // QBO accepts one row per line, repeating the invoice header columns.
  // We expose the resolved account name as "Item(Product/Service)" so QBO's
  // import wizard maps each line to the correct income account.
  //
  // The 1099 income category is exported in two places: appended to the
  // ItemDescription as "[1099: <label>]" (so it's visible on the printed
  // invoice and survives import even if the IncomeCategory column is dropped
  // during mapping), and as a dedicated IncomeCategory column for downstream
  // reconciliation against the year-end 1099-NEC/MISC/K worksheet.
  const headers = [
    "InvoiceNo",
    "Customer",
    "InvoiceDate",
    "DueDate",
    "Item(Product/Service)",
    "ItemDescription",
    "ItemAmount",
    "ItemTaxAmount",
    "Memo",
    "IncomeCategory",
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
    const scope = {
      vendorId: inv.vendorId ?? null,
      partnerId: inv.partnerId ?? null,
    };
    if (ls.length === 0) {
      rows.push([
        inv.invoiceNumber,
        inv.partnerName,
        fmtCsvDate(inv.invoiceDate),
        inv.dueDate ? fmtCsvDate(inv.dueDate) : "",
        resolver("other", scope).name,
        inv.memo ?? "",
        Number(inv.total).toFixed(2),
        Number(inv.taxTotal).toFixed(2),
        inv.memo ?? "",
        "",
      ]);
      continue;
    }
    for (const l of ls) {
      const cat = l.incomeCategory ?? null;
      const catLabel = cat && cat !== "none" ? incomeCategoryLabel(cat) : "";
      rows.push([
        inv.invoiceNumber,
        inv.partnerName,
        fmtCsvDate(inv.invoiceDate),
        inv.dueDate ? fmtCsvDate(inv.dueDate) : "",
        resolver(l.lineType, scope).name,
        memoWith1099Tag(l.description, cat),
        Number(l.amount).toFixed(2),
        Number(l.taxAmount).toFixed(2),
        inv.memo ?? "",
        catLabel,
      ]);
    }
  }
  return toCsv(headers, rows);
}

export function readmeQbo(periodLabel: string, vendorName: string): string {
  return [
    `VNDRLY → QuickBooks Online Import Bundle`,
    `=========================================`,
    ``,
    `Vendor: ${vendorName}`,
    `Period: ${periodLabel}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Files:`,
    `  customers.csv  - Import via Settings → Import Data → Customers`,
    `  vendors.csv    - Import via Settings → Import Data → Vendors`,
    `  invoices.csv   - Import via Settings → Import Data → Invoices`,
    ``,
    `IMPORT ORDER MATTERS: Customers first, then Vendors, then Invoices.`,
    ``,
    `QBO will prompt you to map columns on the first import. Defaults`,
    `should map straight through; verify the InvoiceDate / DueDate format`,
    `matches your locale before confirming.`,
    ``,
    `1099 INCOME CATEGORY: invoices.csv carries the per-line income category`,
    `in two places — appended to ItemDescription as "[1099: <label>]" and as`,
    `a dedicated IncomeCategory column. QBO's standard import wizard will`,
    `usually skip the IncomeCategory column; that's expected — the bracketed`,
    `tag in ItemDescription preserves the classification on the printed`,
    `invoice and is what your accountant uses at year end.`,
    ``,
  ].join("\r\n");
}
