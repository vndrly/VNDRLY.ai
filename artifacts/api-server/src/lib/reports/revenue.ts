// Revenue / spend aggregations sourced from invoice_lines (NOT raw ticket
// line items) so the report exactly matches what was billed. Uses the
// invoice's period_start as the time anchor so an invoice's revenue lands
// in the same period regardless of when individual ticket line items were
// punched.

import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  partnersTable,
  vendorsTable,
  workTypesTable,
  ticketsTable,
} from "@workspace/db";
import type { Period } from "./period";

// We deliberately exclude draft / cancelled invoices from revenue reports —
// only billable invoices (open / sent / paid / overdue) count.
const REVENUE_STATUSES = ["open", "sent", "paid", "overdue"] as const;

export interface RevenueByPartnerRow {
  partnerId: number;
  partnerName: string | null;
  invoiceCount: number;
  subtotal: string;
  taxTotal: string;
  total: string;
}

export async function revenueByPartner(args: {
  vendorId: number;
  period: Period;
}): Promise<RevenueByPartnerRow[]> {
  const rows = await db
    .select({
      partnerId: invoicesTable.partnerId,
      partnerName: partnersTable.name,
      invoiceCount: sql<number>`count(*)::int`,
      subtotal: sql<string>`COALESCE(SUM(${invoicesTable.subtotal}::numeric), 0)::numeric(14,2)`,
      taxTotal: sql<string>`COALESCE(SUM(${invoicesTable.taxTotal}::numeric), 0)::numeric(14,2)`,
      total: sql<string>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)::numeric(14,2)`,
    })
    .from(invoicesTable)
    .leftJoin(partnersTable, eq(partnersTable.id, invoicesTable.partnerId))
    .where(
      and(
        eq(invoicesTable.vendorId, args.vendorId),
        inArray(invoicesTable.status, [...REVENUE_STATUSES]),
        gte(invoicesTable.periodStart, args.period.start),
        lt(invoicesTable.periodStart, args.period.end),
      ),
    )
    .groupBy(invoicesTable.partnerId, partnersTable.name);

  return rows;
}

export interface RevenueByWorkTypeRow {
  workTypeId: number | null;
  workTypeName: string;
  lineCount: number;
  amount: string;
}

export async function revenueByWorkType(args: {
  vendorId?: number;
  partnerId?: number;
  period: Period;
}): Promise<RevenueByWorkTypeRow[]> {
  const conds = [
    inArray(invoicesTable.status, [...REVENUE_STATUSES]),
    gte(invoicesTable.periodStart, args.period.start),
    lt(invoicesTable.periodStart, args.period.end),
  ];
  if (args.vendorId) conds.push(eq(invoicesTable.vendorId, args.vendorId));
  if (args.partnerId) conds.push(eq(invoicesTable.partnerId, args.partnerId));

  // Resolve work_type via tickets joined through invoice_lines.ticketId.
  const rows = await db
    .select({
      workTypeId: ticketsTable.workTypeId,
      workTypeName: sql<string>`COALESCE(${workTypesTable.name}, 'Unassigned')`,
      lineCount: sql<number>`count(*)::int`,
      amount: sql<string>`COALESCE(SUM(${invoiceLinesTable.amount}::numeric), 0)::numeric(14,2)`,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .leftJoin(ticketsTable, eq(ticketsTable.id, invoiceLinesTable.ticketId))
    .leftJoin(workTypesTable, eq(workTypesTable.id, ticketsTable.workTypeId))
    .where(and(...conds))
    .groupBy(ticketsTable.workTypeId, workTypesTable.name);

  return rows.sort((a, b) => Number(b.amount) - Number(a.amount));
}

export interface RevenueByAfeRow {
  afe: string;
  lineCount: number;
  amount: string;
}

export async function revenueByAfe(args: {
  vendorId?: number;
  partnerId?: number;
  period: Period;
}): Promise<RevenueByAfeRow[]> {
  const conds = [
    inArray(invoicesTable.status, [...REVENUE_STATUSES]),
    gte(invoicesTable.periodStart, args.period.start),
    lt(invoicesTable.periodStart, args.period.end),
  ];
  if (args.vendorId) conds.push(eq(invoicesTable.vendorId, args.vendorId));
  if (args.partnerId) conds.push(eq(invoicesTable.partnerId, args.partnerId));

  const rows = await db
    .select({
      afe: sql<string>`COALESCE(${invoiceLinesTable.afe}, '(unassigned)')`,
      lineCount: sql<number>`count(*)::int`,
      amount: sql<string>`COALESCE(SUM(${invoiceLinesTable.amount}::numeric), 0)::numeric(14,2)`,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .where(and(...conds))
    .groupBy(invoiceLinesTable.afe);

  return rows.sort((a, b) => Number(b.amount) - Number(a.amount));
}

export interface SpendByVendorRow {
  vendorId: number;
  vendorName: string | null;
  invoiceCount: number;
  subtotal: string;
  taxTotal: string;
  total: string;
}

export async function spendByVendor(args: {
  partnerId: number;
  period: Period;
}): Promise<SpendByVendorRow[]> {
  const rows = await db
    .select({
      vendorId: invoicesTable.vendorId,
      vendorName: vendorsTable.name,
      invoiceCount: sql<number>`count(*)::int`,
      subtotal: sql<string>`COALESCE(SUM(${invoicesTable.subtotal}::numeric), 0)::numeric(14,2)`,
      taxTotal: sql<string>`COALESCE(SUM(${invoicesTable.taxTotal}::numeric), 0)::numeric(14,2)`,
      total: sql<string>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)::numeric(14,2)`,
    })
    .from(invoicesTable)
    .leftJoin(vendorsTable, eq(vendorsTable.id, invoicesTable.vendorId))
    .where(
      and(
        eq(invoicesTable.partnerId, args.partnerId),
        inArray(invoicesTable.status, [...REVENUE_STATUSES]),
        gte(invoicesTable.periodStart, args.period.start),
        lt(invoicesTable.periodStart, args.period.end),
      ),
    )
    .groupBy(invoicesTable.vendorId, vendorsTable.name);

  return rows.sort((a, b) => Number(b.total) - Number(a.total));
}
