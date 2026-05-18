// 1099 income-category vs. line-type health check.
//
// The matching heuristic (`suspectMatch` + `ALLOWED_CATEGORIES_BY_LINE_TYPE`)
// lives in the shared `@workspace/form1099` package so the in-the-moment
// invoice warnings on the client and this year-end audit always agree.
// This module is the read-side: it pulls every active invoice line for a
// vendor or partner and reports the ones the heuristic flags.

import { and, desc, eq } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  vendorsTable,
  partnersTable,
  type InvoiceLineIncomeCategory,
} from "@workspace/db";
import { suspectMatch } from "@workspace/form1099";

export { suspectMatch };

export interface CategoryAuditMismatch {
  invoiceId: number;
  invoiceNumber: string;
  invoiceStatus: string;
  invoiceTotal: string;
  invoiceCreatedAt: string;
  vendorId: number;
  vendorName: string;
  partnerId: number;
  partnerName: string;
  lineId: number;
  lineType: string;
  description: string;
  amount: string;
  incomeCategory: string;
  /** Categories the heuristic considers reasonable for this line type. */
  suggestedCategories: InvoiceLineIncomeCategory[];
}

export interface CategoryAuditSummary {
  /** Per income-category counts of suspect lines. */
  byCategory: Record<string, number>;
  /** Per line-type counts of suspect lines. */
  byLineType: Record<string, number>;
  /** Sum of all suspect line amounts. Used for the report subtitle. */
  totalAmount: string;
}

export interface CategoryAuditResult {
  rows: CategoryAuditMismatch[];
  summary: CategoryAuditSummary;
}

/**
 * Audit every non-cancelled invoice line for a vendor (or partner) and
 * return the lines whose `income_category` is implausible for their
 * `line_type`. Cancelled invoices are excluded — they don't roll up
 * onto any 1099 form so their misclassifications are noise.
 */
export async function categoryAuditRows(args: {
  vendorId?: number;
  partnerId?: number;
}): Promise<CategoryAuditResult> {
  const conds = [];
  if (args.vendorId) conds.push(eq(invoicesTable.vendorId, args.vendorId));
  if (args.partnerId) conds.push(eq(invoicesTable.partnerId, args.partnerId));

  const raw = await db
    .select({
      invoiceId: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceStatus: invoicesTable.status,
      invoiceTotal: invoicesTable.total,
      invoiceCreatedAt: invoicesTable.createdAt,
      vendorId: invoicesTable.vendorId,
      vendorName: vendorsTable.name,
      partnerId: invoicesTable.partnerId,
      partnerName: partnersTable.name,
      lineId: invoiceLinesTable.id,
      lineType: invoiceLinesTable.lineType,
      description: invoiceLinesTable.description,
      amount: invoiceLinesTable.amount,
      incomeCategory: invoiceLinesTable.incomeCategory,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .innerJoin(vendorsTable, eq(vendorsTable.id, invoicesTable.vendorId))
    .innerJoin(partnersTable, eq(partnersTable.id, invoicesTable.partnerId))
    .where(and(...conds))
    .orderBy(desc(invoicesTable.createdAt));

  const rows: CategoryAuditMismatch[] = [];
  for (const r of raw) {
    if (r.invoiceStatus === "cancelled") continue;
    const m = suspectMatch(r.lineType, r.incomeCategory);
    if (!m.suspect) continue;
    rows.push({
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      invoiceStatus: r.invoiceStatus,
      invoiceTotal: r.invoiceTotal,
      invoiceCreatedAt:
        r.invoiceCreatedAt instanceof Date
          ? r.invoiceCreatedAt.toISOString()
          : String(r.invoiceCreatedAt),
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      lineId: r.lineId,
      lineType: r.lineType,
      description: r.description,
      amount: r.amount,
      incomeCategory: r.incomeCategory,
      suggestedCategories: m.suggested,
    });
  }

  const byCategory: Record<string, number> = {};
  const byLineType: Record<string, number> = {};
  let totalAmountCents = 0;
  for (const row of rows) {
    byCategory[row.incomeCategory] =
      (byCategory[row.incomeCategory] ?? 0) + 1;
    byLineType[row.lineType] = (byLineType[row.lineType] ?? 0) + 1;
    totalAmountCents += Math.round(Number(row.amount) * 100);
  }

  return {
    rows,
    summary: {
      byCategory,
      byLineType,
      totalAmount: (totalAmountCents / 100).toFixed(2),
    },
  };
}
