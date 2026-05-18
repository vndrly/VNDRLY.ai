// Sales tax aggregation per state per period. Sources: invoice_lines.taxState,
// invoice_lines.taxAmount, and invoice_lines.amount split into taxable vs
// exempt by the line's `taxable` boolean.
//
// Lines that have no taxState are aggregated under "(unassigned)" — these
// indicate a billing-config gap that the vendor should fix; we surface them
// rather than dropping them.

import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
} from "@workspace/db";
import type { Period } from "./period";

const REVENUE_STATUSES = ["open", "sent", "paid", "overdue"] as const;

export interface SalesTaxByStateRow {
  state: string;
  taxableSales: string;
  exemptSales: string;
  taxCollected: string;
  /** Effective rate = taxCollected / taxableSales, expressed as decimal (0.0825 = 8.25%). */
  effectiveRate: string;
}

export async function salesTaxByState(args: {
  vendorId?: number;
  partnerId?: number;
  period: Period;
}): Promise<{ rows: SalesTaxByStateRow[]; totals: SalesTaxByStateRow }> {
  const conds = [
    inArray(invoicesTable.status, [...REVENUE_STATUSES]),
    gte(invoicesTable.periodStart, args.period.start),
    lt(invoicesTable.periodStart, args.period.end),
  ];
  if (args.vendorId) conds.push(eq(invoicesTable.vendorId, args.vendorId));
  if (args.partnerId) conds.push(eq(invoicesTable.partnerId, args.partnerId));

  const rows = await db
    .select({
      state: sql<string>`COALESCE(${invoiceLinesTable.taxState}, '(unassigned)')`,
      taxableSales: sql<string>`COALESCE(SUM(CASE WHEN ${invoiceLinesTable.taxable} THEN ${invoiceLinesTable.amount}::numeric ELSE 0 END), 0)::numeric(14,2)`,
      exemptSales: sql<string>`COALESCE(SUM(CASE WHEN ${invoiceLinesTable.taxable} THEN 0 ELSE ${invoiceLinesTable.amount}::numeric END), 0)::numeric(14,2)`,
      taxCollected: sql<string>`COALESCE(SUM(${invoiceLinesTable.taxAmount}::numeric), 0)::numeric(14,2)`,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .where(and(...conds))
    .groupBy(invoiceLinesTable.taxState);

  const enriched = rows.map((r) => {
    const tax = Number(r.taxCollected);
    const taxable = Number(r.taxableSales);
    const eff = taxable > 0 ? tax / taxable : 0;
    return { ...r, effectiveRate: eff.toFixed(4) };
  });
  enriched.sort((a, b) => Number(b.taxCollected) - Number(a.taxCollected));

  const totals: SalesTaxByStateRow = enriched.reduce(
    (acc, r) => {
      const t = Number(r.taxableSales) + Number(acc.taxableSales);
      const e = Number(r.exemptSales) + Number(acc.exemptSales);
      const c = Number(r.taxCollected) + Number(acc.taxCollected);
      return {
        state: "TOTAL",
        taxableSales: t.toFixed(2),
        exemptSales: e.toFixed(2),
        taxCollected: c.toFixed(2),
        effectiveRate: t > 0 ? (c / t).toFixed(4) : "0.0000",
      };
    },
    {
      state: "TOTAL",
      taxableSales: "0.00",
      exemptSales: "0.00",
      taxCollected: "0.00",
      effectiveRate: "0.0000",
    } as SalesTaxByStateRow,
  );

  return { rows: enriched, totals };
}
