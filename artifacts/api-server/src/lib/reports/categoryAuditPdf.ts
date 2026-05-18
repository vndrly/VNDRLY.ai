// 1099 category audit PDF.
//
// Renders the suspect-line list AP needs to clean up before year-end as a
// landscape-letter table, using the same `renderReportPdf` pipeline that
// powers the other tabular report PDFs (aging, revenue-by-partner, etc.)
// and that sits next to the IRS-layout `renderNec1099Pdf` /
// `renderK1099Pdf` helpers in `pdf.ts`. Like those, output is intended
// for record-keeping / audit work papers — it is not an IRS form.

import type { CategoryAuditResult } from "./categoryAudit";
import { renderReportPdf } from "./pdf";

export interface CategoryAuditPdfScope {
  /** "Vendor X" or "Partner Y" — drawn under the title. */
  scopeLabel: string;
}

export async function renderCategoryAuditPdf(
  audit: CategoryAuditResult,
  scope: CategoryAuditPdfScope,
): Promise<Buffer> {
  const { rows, summary } = audit;
  const subtitle =
    rows.length === 0
      ? `${scope.scopeLabel} — no suspect lines`
      : `${scope.scopeLabel} — ${rows.length} suspect line${rows.length === 1 ? "" : "s"} totaling $${summary.totalAmount}`;

  return renderReportPdf({
    title: "1099 Category Audit",
    subtitle,
    columns: [
      { header: "Invoice #", width: 1.2 },
      { header: "Status", width: 0.9 },
      { header: "Vendor", width: 2 },
      { header: "Partner", width: 2 },
      { header: "Line type", width: 1.4 },
      { header: "Income category", width: 1.6 },
      { header: "Suggested", width: 1.8 },
      { header: "Description", width: 2.4 },
      { header: "Amount", width: 1, align: "right" },
    ],
    rows: rows.map((r) => [
      r.invoiceNumber,
      r.invoiceStatus,
      r.vendorName,
      r.partnerName,
      r.lineType,
      r.incomeCategory,
      r.suggestedCategories.join(", ") || "—",
      r.description,
      r.amount,
    ]),
    totals:
      rows.length > 0
        ? [
            `TOTAL (${rows.length} suspect line${rows.length === 1 ? "" : "s"})`,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            summary.totalAmount,
          ]
        : undefined,
    footer:
      "Suspect = invoice line whose income_category is implausible for its line_type per the shared 1099 heuristic. Cancelled invoices are excluded.",
  });
}
