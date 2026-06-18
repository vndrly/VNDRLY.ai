// Extended read-only data tools for AskV — field/foreman ticket drill-down
// and vendor/partner financial reporting. Scoped server-side; never writes.

import { and, desc, eq, gte, ilike, isNull, sql } from "drizzle-orm";
import {
  db,
  ticketsTable,
  ticketCrewTable,
  ticketCheckInsTable,
  ticketNoteLogsTable,
  ticketLineItemsTable,
  vendorPeopleTable,
  workTypesTable,
  siteLocationsTable,
  invoicesTable,
} from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import {
  fieldEmployeeCanAccessTicket,
  loadFieldTicketAccessRow,
} from "../lib/field-ticket-access";
import { resolvePeriod, PERIOD_PRESETS, type PeriodPreset } from "../lib/reports/period";
import { lineDetailRows } from "../lib/reports/line-detail";
import { agingForPartner, agingForVendor } from "../lib/reports/aging";
import {
  revenueByPartner,
  revenueByWorkType,
  spendByVendor,
} from "../lib/reports/revenue";
import { crewHoursBilledVsCost } from "../lib/reports/crew-cost";
import { k1099Rows, thresholdForYear } from "../lib/reports/k1099";
import { misc1099Rows } from "../lib/reports/misc1099";
import {
  blockFieldEmployee,
  clampLimit,
  clampSinceDays,
  DEFAULT_SINCE_DAYS,
  err,
  MAX_LIMIT,
  sinceDate,
  ticketScopeFilters,
} from "./data-tools-helpers";

// ─────────────────────────────────────────────────────────────────
// Ticket visibility (single-ticket tools)
// ─────────────────────────────────────────────────────────────────

async function assertTicketVisible(
  ticketId: number,
  session: SessionPayload,
): Promise<string | null> {
  if (session.role === "field_employee") {
    if (!session.vendorPeopleId || !session.userId || !session.vendorId) {
      return err("No org scope on this session.");
    }
    const ticket = await loadFieldTicketAccessRow(ticketId);
    if (!ticket) return err(`Ticket ${ticketId} not found.`);
    const ok = await fieldEmployeeCanAccessTicket(
      ticketId,
      {
        id: session.vendorPeopleId,
        vendorId: session.vendorId,
        userId: session.userId,
      },
      ticket,
    );
    if (!ok) return err(`Ticket ${ticketId} not visible to your account.`);
    return null;
  }

  const scope = ticketScopeFilters(session);
  if (scope === null) return err("No org scope on this session.");
  const [row] = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, ticketId), ...(scope as Parameters<typeof and>)))
    .limit(1);
  if (!row) return err(`Ticket ${ticketId} not visible to your account.`);
  return null;
}

function employeeDisplayName(
  first: string | null,
  last: string | null,
): string {
  return `${first ?? ""} ${last ?? ""}`.trim() || "Unknown";
}

function odometerMiles(
  start: string | null,
  end: string | null,
): number | null {
  if (start == null || end == null) return null;
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return Math.round((e - s) * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────
// query_ticket_detail
// ─────────────────────────────────────────────────────────────────

interface QueryTicketDetailInput {
  ticketId?: number;
}

async function queryTicketDetail(
  input: QueryTicketDetailInput,
  session: SessionPayload,
): Promise<string> {
  if (typeof input.ticketId !== "number") return err("Missing 'ticketId'.");
  const denied = await assertTicketVisible(input.ticketId, session);
  if (denied) return denied;

  const [row] = await db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      lifecycleState: ticketsTable.lifecycleState,
      description: ticketsTable.description,
      notes: ticketsTable.notes,
      kickbackReason: ticketsTable.kickbackReason,
      checkInTime: ticketsTable.checkInTime,
      checkOutTime: ticketsTable.checkOutTime,
      startingMileage: ticketsTable.startingMileage,
      endingMileage: ticketsTable.endingMileage,
      createdAt: ticketsTable.createdAt,
      closedAt: ticketsTable.closedAt,
      scheduledStartAt: ticketsTable.scheduledStartAt,
      paymentReceiptUrl: ticketsTable.paymentReceiptUrl,
      workTypeId: ticketsTable.workTypeId,
      workTypeName: workTypesTable.name,
      workTypeCategory: workTypesTable.category,
      siteId: ticketsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      vendorId: ticketsTable.vendorId,
    })
    .from(ticketsTable)
    .innerJoin(workTypesTable, eq(workTypesTable.id, ticketsTable.workTypeId))
    .innerJoin(siteLocationsTable, eq(siteLocationsTable.id, ticketsTable.siteLocationId))
    .where(eq(ticketsTable.id, input.ticketId))
    .limit(1);
  if (!row) return err(`Ticket ${input.ticketId} not found.`);

  const [crewAgg] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ticketCrewTable)
    .where(
      and(
        eq(ticketCrewTable.ticketId, input.ticketId),
        isNull(ticketCrewTable.removedAt),
      ),
    );

  const [noteAgg] = await db
    .select({
      n: sql<number>`count(*)::int`,
      withAttachments: sql<number>`count(*) filter (where cardinality(${ticketNoteLogsTable.attachments}) > 0)`,
    })
    .from(ticketNoteLogsTable)
    .where(
      and(
        eq(ticketNoteLogsTable.ticketId, input.ticketId),
        isNull(ticketNoteLogsTable.deletedAt),
      ),
    );

  const [lineAgg] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ticketLineItemsTable)
    .where(eq(ticketLineItemsTable.ticketId, input.ticketId));

  return JSON.stringify({
    ticketId: row.id,
    status: row.status,
    lifecycleState: row.lifecycleState,
    workType: {
      id: row.workTypeId,
      name: row.workTypeName,
      category: row.workTypeCategory,
    },
    site: { id: row.siteId, name: row.siteName },
    vendorId: row.vendorId,
    description: row.description,
    notes: row.notes,
    kickbackReason: row.kickbackReason,
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime,
    odometerMiles: odometerMiles(row.startingMileage, row.endingMileage),
    startingMileage: row.startingMileage,
    endingMileage: row.endingMileage,
    scheduledStartAt: row.scheduledStartAt,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    hasPaymentReceipt: !!row.paymentReceiptUrl,
    crewCount: Number(crewAgg?.n ?? 0),
    noteCount: Number(noteAgg?.n ?? 0),
    notesWithAttachments: Number(noteAgg?.withAttachments ?? 0),
    lineItemCount: Number(lineAgg?.n ?? 0),
  });
}

// ─────────────────────────────────────────────────────────────────
// query_ticket_crew
// ─────────────────────────────────────────────────────────────────

interface QueryTicketCrewInput {
  ticketId?: number;
}

async function queryTicketCrew(
  input: QueryTicketCrewInput,
  session: SessionPayload,
): Promise<string> {
  if (typeof input.ticketId !== "number") return err("Missing 'ticketId'.");
  const denied = await assertTicketVisible(input.ticketId, session);
  if (denied) return denied;

  const rows = await db
    .select({
      employeeId: ticketCrewTable.employeeId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      vendorRole: vendorPeopleTable.vendorRole,
      ackStatus: ticketCrewTable.ackStatus,
      ackAt: ticketCrewTable.ackAt,
      ackNote: ticketCrewTable.ackNote,
      addedAt: ticketCrewTable.addedAt,
    })
    .from(ticketCrewTable)
    .innerJoin(vendorPeopleTable, eq(vendorPeopleTable.id, ticketCrewTable.employeeId))
    .where(
      and(
        eq(ticketCrewTable.ticketId, input.ticketId),
        isNull(ticketCrewTable.removedAt),
      ),
    )
    .orderBy(ticketCrewTable.addedAt);

  return JSON.stringify({
    ticketId: input.ticketId,
    crewCount: rows.length,
    crew: rows.map((r) => ({
      employeeId: r.employeeId,
      name: employeeDisplayName(r.firstName, r.lastName),
      role: r.vendorRole,
      ackStatus: r.ackStatus,
      ackAt: r.ackAt,
      ackNote: r.ackNote,
      onCrewSince: r.addedAt,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────
// query_ticket_labor
// ─────────────────────────────────────────────────────────────────

interface QueryTicketLaborInput {
  ticketId?: number;
}

async function queryTicketLabor(
  input: QueryTicketLaborInput,
  session: SessionPayload,
): Promise<string> {
  if (typeof input.ticketId !== "number") return err("Missing 'ticketId'.");
  const denied = await assertTicketVisible(input.ticketId, session);
  if (denied) return denied;

  const [ticketRow] = await db
    .select({
      startingMileage: ticketsTable.startingMileage,
      endingMileage: ticketsTable.endingMileage,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, input.ticketId))
    .limit(1);

  const checkIns = await db
    .select({
      employeeId: ticketCheckInsTable.employeeId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      checkInAt: ticketCheckInsTable.checkInAt,
      checkOutAt: ticketCheckInsTable.checkOutAt,
      hourlyRateAtTime: ticketCheckInsTable.hourlyRateAtTime,
      hours: sql<number | null>`CASE WHEN ${ticketCheckInsTable.checkOutAt} IS NOT NULL THEN extract(epoch from (${ticketCheckInsTable.checkOutAt} - ${ticketCheckInsTable.checkInAt})) / 3600.0 ELSE NULL END`,
    })
    .from(ticketCheckInsTable)
    .innerJoin(vendorPeopleTable, eq(vendorPeopleTable.id, ticketCheckInsTable.employeeId))
    .where(eq(ticketCheckInsTable.ticketId, input.ticketId))
    .orderBy(ticketCheckInsTable.checkInAt);

  let totalHours = 0;
  let totalCost = 0;
  const members = checkIns.map((c) => {
    const hours = c.hours != null ? Number(c.hours) : null;
    const rate = c.hourlyRateAtTime != null ? Number(c.hourlyRateAtTime) : 0;
    const estimatedCost =
      hours != null && Number.isFinite(rate) ? Math.round(hours * rate * 100) / 100 : null;
    if (hours != null) totalHours += hours;
    if (estimatedCost != null) totalCost += estimatedCost;
    return {
      employeeId: c.employeeId,
      name: employeeDisplayName(c.firstName, c.lastName),
      checkInAt: c.checkInAt,
      checkOutAt: c.checkOutAt,
      hours: hours != null ? Math.round(hours * 100) / 100 : null,
      hourlyRate: c.hourlyRateAtTime,
      estimatedLaborCost: estimatedCost,
    };
  });

  return JSON.stringify({
    ticketId: input.ticketId,
    members,
    totalHours: Math.round(totalHours * 100) / 100,
    totalEstimatedLaborCost: Math.round(totalCost * 100) / 100,
    odometerMiles: ticketRow
      ? odometerMiles(ticketRow.startingMileage, ticketRow.endingMileage)
      : null,
  });
}

// ─────────────────────────────────────────────────────────────────
// query_ticket_notes
// ─────────────────────────────────────────────────────────────────

interface QueryTicketNotesInput {
  ticketId?: number;
  limit?: number;
}

async function queryTicketNotes(
  input: QueryTicketNotesInput,
  session: SessionPayload,
): Promise<string> {
  if (typeof input.ticketId !== "number") return err("Missing 'ticketId'.");
  const denied = await assertTicketVisible(input.ticketId, session);
  if (denied) return denied;

  const limit = clampLimit(input.limit ?? 10);
  const rows = await db
    .select({
      id: ticketNoteLogsTable.id,
      content: ticketNoteLogsTable.content,
      attachments: ticketNoteLogsTable.attachments,
      createdAt: ticketNoteLogsTable.createdAt,
    })
    .from(ticketNoteLogsTable)
    .where(
      and(
        eq(ticketNoteLogsTable.ticketId, input.ticketId),
        isNull(ticketNoteLogsTable.deletedAt),
      ),
    )
    .orderBy(desc(ticketNoteLogsTable.createdAt))
    .limit(limit);

  return JSON.stringify({
    ticketId: input.ticketId,
    notes: rows.map((r) => ({
      id: r.id,
      content: r.content,
      attachments: r.attachments ?? [],
      attachmentCount: (r.attachments ?? []).length,
      createdAt: r.createdAt,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────
// query_work_type_history — "when was maintenance last done?"
// ─────────────────────────────────────────────────────────────────

interface QueryWorkTypeHistoryInput {
  workTypeName?: string;
  workTypeId?: number;
  siteId?: number;
  sinceDays?: number;
  limit?: number;
}

async function queryWorkTypeHistory(
  input: QueryWorkTypeHistoryInput,
  session: SessionPayload,
): Promise<string> {
  const scope = ticketScopeFilters(session);
  if (scope === null) return err("No org scope on this session.");

  if (typeof input.workTypeId !== "number" && !input.workTypeName?.trim()) {
    return err("Provide workTypeId or workTypeName (e.g. 'Maintenance').");
  }

  const days = clampSinceDays(input.sinceDays ?? 365);
  const limit = clampLimit(input.limit ?? 10);
  const filters: unknown[] = [...scope, gte(ticketsTable.createdAt, sinceDate(days))];

  if (typeof input.workTypeId === "number") {
    filters.push(eq(ticketsTable.workTypeId, input.workTypeId));
  } else if (input.workTypeName?.trim()) {
    filters.push(ilike(workTypesTable.name, `%${input.workTypeName.trim()}%`));
  }
  if (typeof input.siteId === "number") {
    filters.push(eq(ticketsTable.siteLocationId, input.siteId));
  }

  const rows = await db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      createdAt: ticketsTable.createdAt,
      closedAt: ticketsTable.closedAt,
      checkInTime: ticketsTable.checkInTime,
      checkOutTime: ticketsTable.checkOutTime,
      workTypeId: ticketsTable.workTypeId,
      workTypeName: workTypesTable.name,
      siteId: ticketsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      startingMileage: ticketsTable.startingMileage,
      endingMileage: ticketsTable.endingMileage,
    })
    .from(ticketsTable)
    .innerJoin(workTypesTable, eq(workTypesTable.id, ticketsTable.workTypeId))
    .innerJoin(siteLocationsTable, eq(siteLocationsTable.id, ticketsTable.siteLocationId))
    .where(and(...(filters as Parameters<typeof and>)))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(limit);

  return JSON.stringify({
    sinceDays: days,
    workTypeName: input.workTypeName ?? null,
    workTypeId: input.workTypeId ?? null,
    siteId: input.siteId ?? null,
    ticketCount: rows.length,
    tickets: rows.map((r) => ({
      ticketId: r.id,
      status: r.status,
      workType: r.workTypeName,
      site: { id: r.siteId, name: r.siteName },
      createdAt: r.createdAt,
      closedAt: r.closedAt,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
      odometerMiles: odometerMiles(r.startingMileage, r.endingMileage),
    })),
  });
}

// ─────────────────────────────────────────────────────────────────
// Vendor / partner financial toolbox
// ─────────────────────────────────────────────────────────────────

interface QueryInvoicesInput {
  sinceDays?: number;
  status?: string;
  limit?: number;
}

async function queryInvoices(
  input: QueryInvoicesInput,
  session: SessionPayload,
): Promise<string> {
  if (session.role === "field_employee") {
    return err("Field employees don't see invoices.");
  }
  const days = clampSinceDays(input.sinceDays ?? 90);
  const limit = clampLimit(input.limit ?? 20);
  const filters: unknown[] = [gte(invoicesTable.createdAt, sinceDate(days))];
  if (typeof input.status === "string" && input.status.length > 0) {
    filters.push(eq(invoicesTable.status, input.status));
  }
  if (session.role === "vendor" && session.vendorId) {
    filters.push(eq(invoicesTable.vendorId, session.vendorId));
  } else if (session.role === "partner" && session.partnerId) {
    filters.push(eq(invoicesTable.partnerId, session.partnerId));
  } else if (session.role !== "admin") {
    return err("No org scope on this session.");
  }

  const rows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      status: invoicesTable.status,
      vendorId: invoicesTable.vendorId,
      partnerId: invoicesTable.partnerId,
      periodStart: invoicesTable.periodStart,
      periodEnd: invoicesTable.periodEnd,
      dueDate: invoicesTable.dueDate,
      subtotal: invoicesTable.subtotal,
      taxTotal: invoicesTable.taxTotal,
      total: invoicesTable.total,
      paidAmount: invoicesTable.paidAmount,
      createdAt: invoicesTable.createdAt,
    })
    .from(invoicesTable)
    .where(and(...(filters as Parameters<typeof and>)))
    .orderBy(desc(invoicesTable.createdAt))
    .limit(limit);

  return JSON.stringify({ sinceDays: days, invoices: rows, limit });
}

interface QueryInvoiceLinesInput {
  preset?: string;
  limit?: number;
}

async function queryInvoiceLines(
  input: QueryInvoiceLinesInput,
  session: SessionPayload,
): Promise<string> {
  const blocked = blockFieldEmployee(session, "query_invoice_lines");
  if (blocked) return blocked;

  const presetRaw = typeof input.preset === "string" ? input.preset : "ytd";
  const preset: PeriodPreset = (PERIOD_PRESETS as readonly string[]).includes(presetRaw)
    ? (presetRaw as PeriodPreset)
    : "ytd";
  const period = resolvePeriod({ preset });
  const limit = clampLimit(input.limit ?? 25);

  let vendorId: number | undefined;
  let partnerId: number | undefined;
  if (session.role === "vendor" && session.vendorId) {
    vendorId = session.vendorId;
  } else if (session.role === "partner" && session.partnerId) {
    partnerId = session.partnerId;
  } else if (session.role !== "admin") {
    return err("No org scope on this session.");
  }

  const rows = await lineDetailRows({ vendorId, partnerId, period });
  return JSON.stringify({
    periodLabel: period.label,
    preset,
    rowCount: rows.length,
    lines: rows.slice(0, limit).map((r) => ({
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      invoiceStatus: r.invoiceStatus,
      ticketId: r.ticketId,
      partnerName: r.partnerName,
      vendorName: r.vendorName,
      workTypeName: r.workTypeName,
      siteName: r.siteName,
      employeeName: r.employeeName,
      lineType: r.lineType,
      description: r.description,
      quantity: r.quantity,
      unit: r.unit,
      amount: r.amount,
      taxAmount: r.taxAmount,
      incomeCategory: r.incomeCategory,
    })),
  });
}

interface QueryArAgingInput {
  groupBy?: string;
}

async function queryArAging(
  input: QueryArAgingInput,
  session: SessionPayload,
): Promise<string> {
  const blocked = blockFieldEmployee(session, "query_ar_aging");
  if (blocked) return blocked;

  if (session.role === "vendor" && session.vendorId) {
    const { rows, totals } = await agingForVendor(session.vendorId);
    return JSON.stringify({ role: "vendor", vendorId: session.vendorId, rows, totals });
  }
  if (session.role === "partner" && session.partnerId) {
    const { rows, totals } = await agingForPartner(session.partnerId);
    return JSON.stringify({
      role: "partner",
      partnerId: session.partnerId,
      rows,
      totals,
    });
  }
  if (session.role === "admin") {
    return err("Admin: narrow to a vendor or partner account context, or use query_invoice_summary.");
  }
  return err("No org scope on this session.");
}

interface QueryRevenueSummaryInput {
  preset?: string;
  breakdown?: string;
}

async function queryRevenueSummary(
  input: QueryRevenueSummaryInput,
  session: SessionPayload,
): Promise<string> {
  const blocked = blockFieldEmployee(session, "query_revenue_summary");
  if (blocked) return blocked;

  const presetRaw = typeof input.preset === "string" ? input.preset : "ytd";
  const preset: PeriodPreset = (PERIOD_PRESETS as readonly string[]).includes(presetRaw)
    ? (presetRaw as PeriodPreset)
    : "ytd";
  const period = resolvePeriod({ preset });
  const breakdown = input.breakdown ?? "work_type";

  if (session.role === "vendor" && session.vendorId) {
    if (breakdown === "partner") {
      const rows = await revenueByPartner({ vendorId: session.vendorId, period });
      return JSON.stringify({ role: "vendor", preset, periodLabel: period.label, breakdown, rows });
    }
    const rows = await revenueByWorkType({ vendorId: session.vendorId, period });
    return JSON.stringify({ role: "vendor", preset, periodLabel: period.label, breakdown: "work_type", rows });
  }
  if (session.role === "partner" && session.partnerId) {
    if (breakdown === "vendor") {
      const rows = await spendByVendor({ partnerId: session.partnerId, period });
      return JSON.stringify({ role: "partner", preset, periodLabel: period.label, breakdown, rows });
    }
    const rows = await revenueByWorkType({ partnerId: session.partnerId, period });
    return JSON.stringify({ role: "partner", preset, periodLabel: period.label, breakdown: "work_type", rows });
  }
  if (session.role === "admin") {
    return err("Admin: use vendor or partner portal context for revenue breakdowns.");
  }
  return err("No org scope on this session.");
}

interface QueryCrewCostInput {
  preset?: string;
}

async function queryCrewCost(
  input: QueryCrewCostInput,
  session: SessionPayload,
): Promise<string> {
  const blocked = blockFieldEmployee(session, "query_crew_cost");
  if (blocked) return blocked;

  if (session.role !== "vendor" || !session.vendorId) {
    return err("Crew cost report is available to vendor accounts.");
  }

  const presetRaw = typeof input.preset === "string" ? input.preset : "ytd";
  const preset: PeriodPreset = (PERIOD_PRESETS as readonly string[]).includes(presetRaw)
    ? (presetRaw as PeriodPreset)
    : "ytd";
  const period = resolvePeriod({ preset });
  const { rows, totals } = await crewHoursBilledVsCost({
    vendorId: session.vendorId,
    period,
  });

  return JSON.stringify({
    preset,
    periodLabel: period.label,
    rows: rows.slice(0, MAX_LIMIT),
    totals,
  });
}

interface Query1099KSummaryInput {
  year?: number;
}

async function query1099KSummary(
  input: Query1099KSummaryInput,
  session: SessionPayload,
): Promise<string> {
  const blocked = blockFieldEmployee(session, "query_1099_k_summary");
  if (blocked) return blocked;

  const nowYear = new Date().getUTCFullYear();
  const year =
    typeof input.year === "number" && Number.isFinite(input.year)
      ? Math.min(2100, Math.max(2000, Math.floor(input.year)))
      : nowYear;

  let rows;
  if (session.role === "vendor" && session.vendorId) {
    rows = await k1099Rows({ year, vendorId: session.vendorId });
  } else if (session.role === "partner" && session.partnerId) {
    rows = await k1099Rows({ year, payerPartnerId: session.partnerId });
  } else if (session.role === "admin") {
    rows = await k1099Rows({ year });
  } else {
    return err("No org scope on this session.");
  }

  return JSON.stringify({
    year,
    thresholdUsd: thresholdForYear(year),
    recipientCount: rows.length,
    rows: rows.slice(0, MAX_LIMIT).map((r) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      payerPartnerId: r.payerPartnerId,
      payerPartnerName: r.payerPartnerName,
      grossAmount: r.grossAmount,
      transactionCount: r.transactionCount,
      crossedAtMonthIdx: r.crossedAtMonthIdx,
    })),
  });
}

interface Query1099MiscSummaryInput {
  year?: number;
}

async function query1099MiscSummary(
  input: Query1099MiscSummaryInput,
  session: SessionPayload,
): Promise<string> {
  const blocked = blockFieldEmployee(session, "query_1099_misc_summary");
  if (blocked) return blocked;

  const nowYear = new Date().getUTCFullYear();
  const year =
    typeof input.year === "number" && Number.isFinite(input.year)
      ? Math.min(2100, Math.max(2000, Math.floor(input.year)))
      : nowYear;

  let rows;
  if (session.role === "vendor" && session.vendorId) {
    rows = await misc1099Rows({ year, vendorId: session.vendorId });
  } else if (session.role === "partner" && session.partnerId) {
    rows = await misc1099Rows({ year, payerPartnerId: session.partnerId });
  } else if (session.role === "admin") {
    rows = await misc1099Rows({ year });
  } else {
    return err("No org scope on this session.");
  }

  return JSON.stringify({
    year,
    recipientCount: rows.length,
    rows: rows.slice(0, MAX_LIMIT).map((r) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      payerPartnerId: r.payerPartnerId,
      payerPartnerName: r.payerPartnerName,
      box1Rents: r.box1Rents,
      box2Royalties: r.box2Royalties,
      box3OtherIncome: r.box3OtherIncome,
      box6MedicalHealth: r.box6MedicalHealth,
      box10Attorney: r.box10Attorney,
      totalReportable: r.totalReportable,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────
// Public dispatcher
// ─────────────────────────────────────────────────────────────────

export const EXT_DATA_TOOL_NAMES = [
  "query_ticket_detail",
  "query_ticket_crew",
  "query_ticket_labor",
  "query_ticket_notes",
  "query_work_type_history",
  "query_invoices",
  "query_invoice_lines",
  "query_ar_aging",
  "query_revenue_summary",
  "query_crew_cost",
  "query_1099_k_summary",
  "query_1099_misc_summary",
] as const;

export type ExtDataToolName = (typeof EXT_DATA_TOOL_NAMES)[number];

export function isExtDataTool(name: string): name is ExtDataToolName {
  return (EXT_DATA_TOOL_NAMES as readonly string[]).includes(name);
}

export async function runExtDataTool(
  name: ExtDataToolName,
  input: unknown,
  session: SessionPayload,
): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "query_ticket_detail":
      return queryTicketDetail(args as QueryTicketDetailInput, session);
    case "query_ticket_crew":
      return queryTicketCrew(args as QueryTicketCrewInput, session);
    case "query_ticket_labor":
      return queryTicketLabor(args as QueryTicketLaborInput, session);
    case "query_ticket_notes":
      return queryTicketNotes(args as QueryTicketNotesInput, session);
    case "query_work_type_history":
      return queryWorkTypeHistory(args as QueryWorkTypeHistoryInput, session);
    case "query_invoices":
      return queryInvoices(args as QueryInvoicesInput, session);
    case "query_invoice_lines":
      return queryInvoiceLines(args as QueryInvoiceLinesInput, session);
    case "query_ar_aging":
      return queryArAging(args as QueryArAgingInput, session);
    case "query_revenue_summary":
      return queryRevenueSummary(args as QueryRevenueSummaryInput, session);
    case "query_crew_cost":
      return queryCrewCost(args as QueryCrewCostInput, session);
    case "query_1099_k_summary":
      return query1099KSummary(args as Query1099KSummaryInput, session);
    case "query_1099_misc_summary":
      return query1099MiscSummary(args as Query1099MiscSummaryInput, session);
  }
}
