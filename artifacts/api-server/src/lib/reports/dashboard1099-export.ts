// Shared CSV / PDF builders for the 1099-K monthly breakout. Extracted
// from `routes/reports.ts` (Task #806) so both the user-triggered
// download endpoints and the scheduled email worker can produce
// byte-identical attachments without duplicating the column layout.

import { toCsv } from "./csv";
import { renderReportPdf } from "./pdf";
import type { Dashboard1099Row } from "./dashboard1099";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// Compute the running year-to-date gross per month from a row's
// per-month amounts. Mirrors the on-screen `monthlyYtd` computation in
// `MonthlyBreakoutCells` so the CSV's `JanYTD…DecYTD` columns match the
// "YTD: $X" line auditors see in the dashboard cell.
function monthlyYtd(monthly: string[]): string[] {
  const out: string[] = [];
  let running = 0;
  for (let i = 0; i < 12; i++) {
    running += Number(monthly[i] ?? 0);
    out.push(running.toFixed(2));
  }
  return out;
}

// CSV export of the 1099-K monthly breakout shown on the year-end
// dashboard. One row per (payer, recipient) with Jan…Dec gross amounts,
// parallel JanYTD…DecYTD running cumulative columns (Task #793) so
// auditors don't have to re-derive the cumulative in a spreadsheet, and
// the transaction count (Box 3). The trailing CrossedAtMonth /
// CrossedAtMonthYTD columns reproduce the on-screen "Crossed" tooltip's
// month label and YTD-at-cross so reconciliations line up. Filters to K
// rows only — NEC and MISC do not carry a per-month breakout.
export function dashboard1099MonthlyKCsv(rows: Dashboard1099Row[]): string {
  return toCsv(
    [
      "TaxYear",
      "PayerPartnerId",
      "PayerName",
      "RecipientVendorId",
      "RecipientName",
      "RecipientTIN",
      "TotalReportable",
      "TransactionCount",
      ...MONTH_LABELS,
      ...MONTH_LABELS.map((m) => `${m}YTD`),
      "CrossedAtMonth",
      "CrossedAtMonthYTD",
    ],
    rows.map((r) => {
      const ytd = monthlyYtd(r.monthly);
      const crossedIdx = r.crossedAtMonthIdx;
      const crossedLabel =
        crossedIdx !== null && crossedIdx >= 0 && crossedIdx < 12
          ? MONTH_LABELS[crossedIdx]
          : "";
      const crossedYtd =
        crossedIdx !== null && crossedIdx >= 0 && crossedIdx < 12
          ? (ytd[crossedIdx] ?? "")
          : "";
      return [
        r.taxYear,
        r.payerPartnerId,
        r.payerPartnerName,
        r.recipientVendorId,
        r.recipientName,
        r.federalTaxId ?? "",
        r.totalReportable,
        r.transactionCount,
        ...r.monthly,
        ...ytd,
        crossedLabel,
        crossedYtd,
      ];
    }),
  );
}

// Print-friendly PDF of the 1099-K monthly breakout. Mirrors the CSV
// columns (payer, recipient, EIN, total, txn count, Jan…Dec) so AP
// staff can attach the same year-end summary to a paper filing packet.
export async function dashboard1099MonthlyKPdf(
  year: number,
  rows: Dashboard1099Row[],
  scopeLabel: string,
): Promise<Buffer> {
  const sumStr = (sel: (r: Dashboard1099Row) => string): string =>
    rows.reduce((s, r) => s + Number(sel(r) || 0), 0).toFixed(2);
  const totalTxns = rows.reduce((s, r) => s + r.transactionCount, 0);
  return renderReportPdf({
    title: "1099-K Monthly Breakout",
    subtitle: scopeLabel,
    periodLabel: `Tax Year ${year}`,
    columns: [
      { header: "Payer", width: 2.4 },
      { header: "Recipient", width: 2.4 },
      { header: "EIN/TIN", width: 1.2 },
      { header: "Total", width: 1.2, align: "right" },
      { header: "Txns", width: 0.6, align: "right" },
      { header: "Jan", width: 1, align: "right" },
      { header: "Feb", width: 1, align: "right" },
      { header: "Mar", width: 1, align: "right" },
      { header: "Apr", width: 1, align: "right" },
      { header: "May", width: 1, align: "right" },
      { header: "Jun", width: 1, align: "right" },
      { header: "Jul", width: 1, align: "right" },
      { header: "Aug", width: 1, align: "right" },
      { header: "Sep", width: 1, align: "right" },
      { header: "Oct", width: 1, align: "right" },
      { header: "Nov", width: 1, align: "right" },
      { header: "Dec", width: 1, align: "right" },
    ],
    rows: rows.map((r) => [
      r.payerPartnerName,
      r.recipientName,
      r.federalTaxId ?? "—",
      r.totalReportable,
      r.transactionCount,
      ...r.monthly,
    ]),
    totals:
      rows.length > 0
        ? [
            `TOTAL (${rows.length} recipient${rows.length === 1 ? "" : "s"})`,
            "",
            "",
            sumStr((r) => r.totalReportable),
            totalTxns,
            ...Array.from({ length: 12 }, (_, i) =>
              sumStr((r) => r.monthly[i] ?? "0"),
            ),
          ]
        : undefined,
    footer:
      "1099-K monthly breakout — for record-keeping only. Not for IRS submission.",
  });
}
