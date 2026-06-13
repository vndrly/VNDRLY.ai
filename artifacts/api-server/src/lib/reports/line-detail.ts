// Flat invoice-line export for accounting hubs and partner bundles.
// One row per invoice_lines row in the selected period, joined to invoice,
// ticket, partner/vendor, work type, site, and field employee context.

import { and, eq, gte, lt, sql, inArray } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  partnersTable,
  vendorsTable,
  workTypesTable,
  ticketsTable,
  siteLocationsTable,
  fieldEmployeesTable,
} from "@workspace/db";
import { toCsv } from "./csv";
import type { Period } from "./period";

const REVENUE_STATUSES = ["open", "sent", "paid", "overdue"] as const;

export interface LineDetailRow {
  invoiceId: number;
  invoiceNumber: string;
  invoiceStatus: string;
  invoiceDate: string | null;
  periodStart: string;
  periodEnd: string;
  ticketId: number | null;
  partnerId: number;
  partnerName: string | null;
  vendorId: number;
  vendorName: string | null;
  workTypeName: string | null;
  siteName: string | null;
  employeeName: string | null;
  lineType: string;
  description: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  amount: string;
  taxable: boolean;
  taxState: string | null;
  taxRate: string | null;
  taxAmount: string;
  afe: string | null;
  incomeCategory: string;
}

function scopeConds(args: {
  vendorId?: number;
  partnerId?: number;
  period: Period;
}) {
  const conds = [
    inArray(invoicesTable.status, [...REVENUE_STATUSES]),
    gte(invoicesTable.periodStart, args.period.start),
    lt(invoicesTable.periodStart, args.period.end),
  ];
  if (args.vendorId) conds.push(eq(invoicesTable.vendorId, args.vendorId));
  if (args.partnerId) conds.push(eq(invoicesTable.partnerId, args.partnerId));
  return conds;
}

export async function lineDetailRows(args: {
  vendorId?: number;
  partnerId?: number;
  period: Period;
}): Promise<LineDetailRow[]> {
  const rows = await db
    .select({
      invoiceId: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceStatus: invoicesTable.status,
      invoiceDate: invoicesTable.generatedAt,
      periodStart: invoicesTable.periodStart,
      periodEnd: invoicesTable.periodEnd,
      ticketId: invoiceLinesTable.ticketId,
      partnerId: invoicesTable.partnerId,
      partnerName: partnersTable.name,
      vendorId: invoicesTable.vendorId,
      vendorName: vendorsTable.name,
      workTypeName: workTypesTable.name,
      siteName: siteLocationsTable.name,
      employeeName: sql<string | null>`NULLIF(TRIM(COALESCE(${fieldEmployeesTable.firstName}, '') || ' ' || COALESCE(${fieldEmployeesTable.lastName}, '')), '')`,
      lineType: invoiceLinesTable.lineType,
      description: invoiceLinesTable.description,
      quantity: invoiceLinesTable.quantity,
      unit: invoiceLinesTable.unit,
      unitPrice: invoiceLinesTable.unitPrice,
      amount: invoiceLinesTable.amount,
      taxable: invoiceLinesTable.taxable,
      taxState: invoiceLinesTable.taxState,
      taxRate: invoiceLinesTable.taxRate,
      taxAmount: invoiceLinesTable.taxAmount,
      afe: invoiceLinesTable.afe,
      incomeCategory: invoiceLinesTable.incomeCategory,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .leftJoin(partnersTable, eq(partnersTable.id, invoicesTable.partnerId))
    .leftJoin(vendorsTable, eq(vendorsTable.id, invoicesTable.vendorId))
    .leftJoin(ticketsTable, eq(ticketsTable.id, invoiceLinesTable.ticketId))
    .leftJoin(workTypesTable, eq(workTypesTable.id, ticketsTable.workTypeId))
    .leftJoin(
      siteLocationsTable,
      eq(siteLocationsTable.id, ticketsTable.siteLocationId),
    )
    .leftJoin(
      fieldEmployeesTable,
      eq(fieldEmployeesTable.id, ticketsTable.fieldEmployeeId),
    )
    .where(and(...scopeConds(args)))
    .orderBy(
      invoicesTable.invoiceNumber,
      invoiceLinesTable.sortOrder,
      invoiceLinesTable.id,
    );

  return rows.map((r) => ({
    ...r,
    invoiceDate: r.invoiceDate ? r.invoiceDate.toISOString() : null,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
  }));
}

const LINE_DETAIL_HEADERS = [
  "InvoiceNumber",
  "InvoiceDate",
  "InvoiceStatus",
  "PeriodStart",
  "PeriodEnd",
  "TicketId",
  "Partner",
  "Vendor",
  "WorkType",
  "Site",
  "Employee",
  "LineType",
  "Description",
  "Quantity",
  "Unit",
  "UnitPrice",
  "Amount",
  "Taxable",
  "TaxState",
  "TaxRate",
  "TaxAmount",
  "AFE",
  "IncomeCategory",
] as const;

export function lineDetailToCsv(rows: LineDetailRow[]): string {
  return toCsv(
    [...LINE_DETAIL_HEADERS],
    rows.map((r) => [
      r.invoiceNumber,
      r.invoiceDate?.slice(0, 10) ?? "",
      r.invoiceStatus,
      r.periodStart.slice(0, 10),
      r.periodEnd.slice(0, 10),
      r.ticketId ?? "",
      r.partnerName ?? `Partner ${r.partnerId}`,
      r.vendorName ?? `Vendor ${r.vendorId}`,
      r.workTypeName ?? "",
      r.siteName ?? "",
      r.employeeName ?? "",
      r.lineType,
      r.description,
      r.quantity,
      r.unit ?? "",
      r.unitPrice,
      r.amount,
      r.taxable ? "true" : "false",
      r.taxState ?? "",
      r.taxRate ?? "",
      r.taxAmount,
      r.afe ?? "",
      r.incomeCategory,
    ]),
  );
}

export interface AccountingExportSummary {
  invoiceCount: number;
  lineCount: number;
  totalAmount: string;
  laborHours: string;
  laborAmount: string;
  partsAmount: string;
  taxTotal: string;
}

export async function accountingExportSummary(args: {
  vendorId?: number;
  partnerId?: number;
  period: Period;
}): Promise<AccountingExportSummary> {
  const conds = scopeConds(args);
  const [row] = await db
    .select({
      invoiceCount: sql<number>`count(DISTINCT ${invoicesTable.id})::int`,
      lineCount: sql<number>`count(*)::int`,
      totalAmount: sql<string>`COALESCE(SUM(${invoiceLinesTable.amount}::numeric), 0)::numeric(14,2)`,
      laborHours: sql<string>`COALESCE(SUM(CASE WHEN ${invoiceLinesTable.lineType} IN ('labor_regular', 'labor_overtime') THEN ${invoiceLinesTable.quantity}::numeric ELSE 0 END), 0)::numeric(14,4)`,
      laborAmount: sql<string>`COALESCE(SUM(CASE WHEN ${invoiceLinesTable.lineType} IN ('labor_regular', 'labor_overtime') THEN ${invoiceLinesTable.amount}::numeric ELSE 0 END), 0)::numeric(14,2)`,
      partsAmount: sql<string>`COALESCE(SUM(CASE WHEN ${invoiceLinesTable.lineType} IN ('materials', 'equipment') THEN ${invoiceLinesTable.amount}::numeric ELSE 0 END), 0)::numeric(14,2)`,
      taxTotal: sql<string>`COALESCE(SUM(${invoiceLinesTable.taxAmount}::numeric), 0)::numeric(14,2)`,
    })
    .from(invoiceLinesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceLinesTable.invoiceId))
    .where(and(...conds));

  return {
    invoiceCount: row?.invoiceCount ?? 0,
    lineCount: row?.lineCount ?? 0,
    totalAmount: row?.totalAmount ?? "0.00",
    laborHours: row?.laborHours ?? "0.0000",
    laborAmount: row?.laborAmount ?? "0.00",
    partsAmount: row?.partsAmount ?? "0.00",
    taxTotal: row?.taxTotal ?? "0.00",
  };
}
