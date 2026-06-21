// Read-only data tools the assistant can call to answer real
// operational questions ("how many tickets are open at site X?",
// "what's our vendor's average rating this month?", "show me the GPS
// trail for ticket 1234").
//
// All five tools share the same shape: they take a JSON input object,
// re-check the caller's role + org scope, run a single bounded SELECT
// against the prod Neon DB, and return a JSON-stringified summary the
// model can quote. No tool here ever writes a row.
//
// Scoping rules (defense-in-depth — the model is *also* told these in
// the system prompt, but we enforce them here regardless):
//   admin           → unrestricted reads
//   partner         → only their own partnerId's tickets/sites/visits/
//                     ratings; cross-vendor reads are filtered to
//                     vendors that have worked at this partner's sites
//   vendor          → only their own vendorId's tickets/ratings/crew
//   field_employee  → tickets they are assigned to, on crew for, or
//                     foreman on; ticket-scoped drill-down tools OK;
//                     org-wide financial aggregates refused
//
// Every result is capped (LIMIT 50 max) and date ranges are clamped
// to [1, 365] days so a runaway model call can't OOM the DB pool.

import { and, eq, gte, lte, ne, desc, sql, count, avg, max, min, sum } from "drizzle-orm";
import {
  db,
  ticketsTable,
  ticketStatusHistoryTable,
  gpsLogsTable,
  vendorRatingsTable,
  siteVisitsTable,
  siteLocationsTable,
  invoicesTable,
} from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { resolvePeriod, PERIOD_PRESETS, type PeriodPreset } from "../lib/reports/period";
import { salesTaxByState } from "../lib/reports/sales-tax";
import { nec1099Rows, NEC_THRESHOLD_USD } from "../lib/reports/nec1099";
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
// Tool: query_tickets
// ─────────────────────────────────────────────────────────────────

interface QueryTicketsInput {
  status?: string;
  vendorId?: number;
  partnerId?: number;
  siteId?: number;
  sinceDays?: number;
  limit?: number;
  countOnly?: boolean;
}

async function queryTickets(input: QueryTicketsInput, session: SessionPayload): Promise<string> {
  const scope = ticketScopeFilters(session);
  if (scope === null) return err("No org scope on this session.");

  const filters: unknown[] = [...scope];
  const days = clampSinceDays(input.sinceDays ?? DEFAULT_SINCE_DAYS);
  filters.push(gte(ticketsTable.createdAt, sinceDate(days)));

  if (typeof input.status === "string" && input.status.length > 0) {
    filters.push(eq(ticketsTable.status, input.status));
  }
  if (typeof input.vendorId === "number") {
    // Partner can ask about any vendor that has worked their sites; the
    // existing partner scope already restricts the row set, so no extra
    // gate needed beyond what we already added.
    if (session.role === "vendor" && session.vendorId && input.vendorId !== session.vendorId) {
      return err("Vendors can only query their own tickets.");
    }
    filters.push(eq(ticketsTable.vendorId, input.vendorId));
  }
  if (typeof input.siteId === "number") {
    filters.push(eq(ticketsTable.siteLocationId, input.siteId));
  }

  if (input.countOnly) {
    const [row] = await db
      .select({ n: count() })
      .from(ticketsTable)
      .where(and(...(filters as Parameters<typeof and>)));
    return JSON.stringify({ count: row?.n ?? 0, sinceDays: days });
  }

  const limit = clampLimit(input.limit);
  const rows = await db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      siteLocationId: ticketsTable.siteLocationId,
      vendorId: ticketsTable.vendorId,
      workTypeId: ticketsTable.workTypeId,
      createdAt: ticketsTable.createdAt,
      checkInTime: ticketsTable.checkInTime,
      checkOutTime: ticketsTable.checkOutTime,
      startingMileage: ticketsTable.startingMileage,
      endingMileage: ticketsTable.endingMileage,
      unlockCount: ticketsTable.unlockCount,
    })
    .from(ticketsTable)
    .where(and(...(filters as Parameters<typeof and>)))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(limit);
  return JSON.stringify({ tickets: rows, sinceDays: days, limit });
}

// ─────────────────────────────────────────────────────────────────
// Tool: query_gps_trail
// ─────────────────────────────────────────────────────────────────

interface QueryGpsTrailInput {
  ticketId?: number;
}

async function queryGpsTrail(input: QueryGpsTrailInput, session: SessionPayload): Promise<string> {
  if (typeof input.ticketId !== "number") return err("Missing 'ticketId'.");

  // Verify the caller can see this ticket using the same scope filter
  // queryTickets uses. One row check, then aggregate the trail.
  const scope = ticketScopeFilters(session);
  if (scope === null) return err("No org scope on this session.");
  const [tk] = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, input.ticketId), ...(scope as Parameters<typeof and>)))
    .limit(1);
  if (!tk) return err(`Ticket ${input.ticketId} not visible to your account.`);

  const [agg] = await db
    .select({
      points: count(),
      firstAt: min(gpsLogsTable.recordedAt),
      lastAt: max(gpsLogsTable.recordedAt),
      maxSpeedMps: max(gpsLogsTable.speedMps),
      minBattery: min(gpsLogsTable.batteryLevel),
    })
    .from(gpsLogsTable)
    .where(eq(gpsLogsTable.ticketId, input.ticketId));

  // Last known position (single row) — useful for "where are they now?"
  const [last] = await db
    .select({
      latitude: gpsLogsTable.latitude,
      longitude: gpsLogsTable.longitude,
      eventType: gpsLogsTable.eventType,
      recordedAt: gpsLogsTable.recordedAt,
    })
    .from(gpsLogsTable)
    .where(eq(gpsLogsTable.ticketId, input.ticketId))
    .orderBy(desc(gpsLogsTable.recordedAt))
    .limit(1);

  return JSON.stringify({
    ticketId: input.ticketId,
    points: agg?.points ?? 0,
    firstAt: agg?.firstAt ?? null,
    lastAt: agg?.lastAt ?? null,
    maxSpeedMps: agg?.maxSpeedMps ?? null,
    minBatteryLevel: agg?.minBattery ?? null,
    last: last ?? null,
  });
}

// ─────────────────────────────────────────────────────────────────
// Tool: query_vendor_performance
// ─────────────────────────────────────────────────────────────────

interface QueryVendorPerformanceInput {
  vendorId?: number;
  sinceDays?: number;
}

async function queryVendorPerformance(
  input: QueryVendorPerformanceInput,
  session: SessionPayload,
): Promise<string> {
  const refusal = blockFieldEmployee(session, "query_vendor_performance");
  if (refusal) return refusal;

  const days = clampSinceDays(input.sinceDays ?? DEFAULT_SINCE_DAYS);
  const since = sinceDate(days);

  // Decide which vendor(s) the caller may see.
  const ratingFilters: unknown[] = [gte(vendorRatingsTable.createdAt, since)];
  if (session.role === "vendor" && session.vendorId) {
    if (typeof input.vendorId === "number" && input.vendorId !== session.vendorId) {
      return err("Vendors can only query their own performance numbers.");
    }
    ratingFilters.push(eq(vendorRatingsTable.vendorId, session.vendorId));
  } else if (session.role === "partner" && session.partnerId) {
    ratingFilters.push(eq(vendorRatingsTable.partnerId, session.partnerId));
    if (typeof input.vendorId === "number") {
      ratingFilters.push(eq(vendorRatingsTable.vendorId, input.vendorId));
    }
  } else if (session.role === "admin") {
    if (typeof input.vendorId === "number") {
      ratingFilters.push(eq(vendorRatingsTable.vendorId, input.vendorId));
    }
  } else {
    return err("No org scope on this session.");
  }

  const [ratings] = await db
    .select({
      n: count(),
      avgRating: avg(vendorRatingsTable.rating),
      maxRating: max(vendorRatingsTable.rating),
      minRating: min(vendorRatingsTable.rating),
    })
    .from(vendorRatingsTable)
    .where(and(...(ratingFilters as Parameters<typeof and>)));

  // Kickback rate over the same window. We count distinct tickets with
  // any kicked_back transition vs total tickets in scope.
  const ticketScope = ticketScopeFilters(session) ?? [];
  const ticketFilters: unknown[] = [
    ...ticketScope,
    gte(ticketsTable.createdAt, since),
  ];
  if (typeof input.vendorId === "number") {
    ticketFilters.push(eq(ticketsTable.vendorId, input.vendorId));
  }
  const [tickets] = await db
    .select({ total: count() })
    .from(ticketsTable)
    .where(and(...(ticketFilters as Parameters<typeof and>)));

  // Distinct ticket IDs that hit kicked_back at least once within the
  // window. Joined with the ticket scope so partners only see their
  // sites and vendors only see their own jobs.
  const [kickbacks] = await db
    .select({ n: sql<number>`count(distinct ${ticketStatusHistoryTable.ticketId})` })
    .from(ticketStatusHistoryTable)
    .innerJoin(ticketsTable, eq(ticketsTable.id, ticketStatusHistoryTable.ticketId))
    .where(
      and(
        eq(ticketStatusHistoryTable.toStatus, "kicked_back"),
        gte(ticketStatusHistoryTable.createdAt, since),
        ...(ticketFilters as Parameters<typeof and>),
      ),
    );

  const totalN = Number(tickets?.total ?? 0);
  const kickN = Number(kickbacks?.n ?? 0);
  const kickbackRate = totalN > 0 ? kickN / totalN : null;

  return JSON.stringify({
    sinceDays: days,
    vendorId: input.vendorId ?? null,
    ratings: {
      n: ratings?.n ?? 0,
      avg: ratings?.avgRating ?? null,
      min: ratings?.minRating ?? null,
      max: ratings?.maxRating ?? null,
    },
    tickets: {
      total: totalN,
      kicked_back: kickN,
      kickback_rate: kickbackRate,
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Tool: query_visits (visitor / guest check-ins per site)
// ─────────────────────────────────────────────────────────────────

interface QueryVisitsInput {
  siteId?: number;
  sinceDays?: number;
  activeOnly?: boolean;
}

async function queryVisits(input: QueryVisitsInput, session: SessionPayload): Promise<string> {
  const refusal = blockFieldEmployee(session, "query_visits");
  if (refusal) return refusal;

  const days = clampSinceDays(input.sinceDays ?? 7);
  const since = sinceDate(days);

  const filters: unknown[] = [gte(siteVisitsTable.checkInTime, since)];

  if (session.role === "partner" && session.partnerId) {
    filters.push(
      sql`${siteVisitsTable.siteLocationId} IN (SELECT id FROM site_locations WHERE partner_id = ${session.partnerId})`,
    );
  } else if (session.role === "vendor" && session.vendorId) {
    filters.push(eq(siteVisitsTable.hostVendorId, session.vendorId));
  } else if (session.role !== "admin") {
    return err("No org scope on this session.");
  }

  if (typeof input.siteId === "number") {
    filters.push(eq(siteVisitsTable.siteLocationId, input.siteId));
  }
  if (input.activeOnly) {
    filters.push(sql`${siteVisitsTable.checkOutTime} IS NULL`);
  }

  const [agg] = await db
    .select({
      total: count(),
      withSafetyAck: sql<number>`count(*) filter (where ${siteVisitsTable.safetyAcknowledgedAt} is not null)`,
    })
    .from(siteVisitsTable)
    .where(and(...(filters as Parameters<typeof and>)));

  return JSON.stringify({
    sinceDays: days,
    siteId: input.siteId ?? null,
    activeOnly: !!input.activeOnly,
    total: Number(agg?.total ?? 0),
    withSafetyAck: Number(agg?.withSafetyAck ?? 0),
  });
}

// ─────────────────────────────────────────────────────────────────
// Tool: query_field_metrics — aggregate KPIs
// ─────────────────────────────────────────────────────────────────

interface QueryFieldMetricsInput {
  sinceDays?: number;
  vendorId?: number;
  partnerId?: number;
  siteId?: number;
}

async function queryFieldMetrics(
  input: QueryFieldMetricsInput,
  session: SessionPayload,
): Promise<string> {
  const refusal = blockFieldEmployee(session, "query_field_metrics");
  if (refusal) return refusal;

  const scope = ticketScopeFilters(session);
  if (scope === null) return err("No org scope on this session.");

  const days = clampSinceDays(input.sinceDays ?? DEFAULT_SINCE_DAYS);
  const since = sinceDate(days);
  const filters: unknown[] = [...scope, gte(ticketsTable.createdAt, since)];

  if (typeof input.vendorId === "number") {
    if (session.role === "vendor" && session.vendorId && input.vendorId !== session.vendorId) {
      return err("Vendors can only query their own metrics.");
    }
    filters.push(eq(ticketsTable.vendorId, input.vendorId));
  }
  if (typeof input.siteId === "number") {
    filters.push(eq(ticketsTable.siteLocationId, input.siteId));
  }

  // Aggregate row: counts by lifecycle bucket + duration + mileage.
  const [agg] = await db
    .select({
      total: count(),
      completed: sql<number>`count(*) filter (where ${ticketsTable.status} in ('completed','closed','approved','funds_dispersed'))`,
      open: sql<number>`count(*) filter (where ${ticketsTable.status} in ('initiated','in_progress','pending_review','submitted','awaiting_acceptance'))`,
      kickedBack: sql<number>`count(*) filter (where ${ticketsTable.status} = 'kicked_back')`,
      cancelled: sql<number>`count(*) filter (where ${ticketsTable.status} = 'cancelled')`,
      avgOnSiteMinutes: sql<number | null>`avg(extract(epoch from (${ticketsTable.checkOutTime} - ${ticketsTable.checkInTime})) / 60.0) filter (where ${ticketsTable.checkInTime} is not null and ${ticketsTable.checkOutTime} is not null)`,
      totalMiles: sql<number | null>`sum((${ticketsTable.endingMileage} - ${ticketsTable.startingMileage})) filter (where ${ticketsTable.endingMileage} is not null and ${ticketsTable.startingMileage} is not null)`,
      withMobileGps: sql<number>`count(distinct ${ticketsTable.id}) filter (where exists (select 1 from gps_logs g where g.ticket_id = ${ticketsTable.id}))`,
      withOdometer: sql<number>`count(*) filter (where ${ticketsTable.startingMileage} is not null or ${ticketsTable.endingMileage} is not null)`,
    })
    .from(ticketsTable)
    .where(and(...(filters as Parameters<typeof and>)));

  const totalN = Number(agg?.total ?? 0);
  const compN = Number(agg?.completed ?? 0);
  const kickN = Number(agg?.kickedBack ?? 0);

  return JSON.stringify({
    sinceDays: days,
    scope: {
      role: session.role,
      vendorId: input.vendorId ?? session.vendorId ?? null,
      partnerId: session.partnerId ?? null,
      siteId: input.siteId ?? null,
    },
    tickets: {
      total: totalN,
      completed: compN,
      open: Number(agg?.open ?? 0),
      kicked_back: kickN,
      cancelled: Number(agg?.cancelled ?? 0),
      completion_rate: totalN > 0 ? compN / totalN : null,
      kickback_rate: totalN > 0 ? kickN / totalN : null,
    },
    avg_on_site_minutes: agg?.avgOnSiteMinutes ?? null,
    total_miles_logged: agg?.totalMiles ?? null,
    mobile_capture: {
      tickets_with_gps_trail: Number(agg?.withMobileGps ?? 0),
      tickets_with_odometer: Number(agg?.withOdometer ?? 0),
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Tool: query_invoice_summary — aggregated $ totals (vendor/partner/admin)
// ─────────────────────────────────────────────────────────────────

interface QueryInvoiceSummaryInput {
  sinceDays?: number;
  status?: string;
}

async function queryInvoiceSummary(
  input: QueryInvoiceSummaryInput,
  session: SessionPayload,
): Promise<string> {
  if (session.role === "field_employee") {
    return err("Field employees don't see invoice totals.");
  }
  const days = clampSinceDays(input.sinceDays ?? DEFAULT_SINCE_DAYS);
  const since = sinceDate(days);
  const filters: unknown[] = [gte(invoicesTable.createdAt, since)];
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
  const [agg] = await db
    .select({
      n: count(),
      totalBilled: sum(invoicesTable.total),
      totalPaid: sum(invoicesTable.paidAmount),
      open: sql<number>`count(*) filter (where ${invoicesTable.status} != 'paid')`,
      pastDue: sql<number>`count(*) filter (where ${invoicesTable.status} != 'paid' and ${invoicesTable.dueDate} < now())`,
    })
    .from(invoicesTable)
    .where(and(...(filters as Parameters<typeof and>)));
  return JSON.stringify({
    sinceDays: days,
    invoices: {
      n: Number(agg?.n ?? 0),
      total_billed: agg?.totalBilled ?? null,
      total_paid: agg?.totalPaid ?? null,
      open: Number(agg?.open ?? 0),
      past_due: Number(agg?.pastDue ?? 0),
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Tool: query_sales_tax_by_state
// ─────────────────────────────────────────────────────────────────

interface QuerySalesTaxByStateInput {
  preset?: string;
  state?: string;
}

async function querySalesTaxByState(
  input: QuerySalesTaxByStateInput,
  session: SessionPayload,
): Promise<string> {
  const blocked = blockFieldEmployee(session, "query_sales_tax_by_state");
  if (blocked) return blocked;

  const presetRaw = typeof input.preset === "string" ? input.preset : "ytd";
  const preset: PeriodPreset = (PERIOD_PRESETS as readonly string[]).includes(presetRaw)
    ? (presetRaw as PeriodPreset)
    : "ytd";
  const period = resolvePeriod({ preset });

  let vendorId: number | undefined;
  let partnerId: number | undefined;
  if (session.role === "vendor" && session.vendorId) {
    vendorId = session.vendorId;
  } else if (session.role === "partner" && session.partnerId) {
    partnerId = session.partnerId;
  } else if (session.role !== "admin") {
    return err("No org scope on this session.");
  }

  const { rows, totals } = await salesTaxByState({ vendorId, partnerId, period });

  let filtered = rows;
  if (typeof input.state === "string" && input.state.trim().length > 0) {
    const st = input.state.trim().toUpperCase();
    filtered = rows.filter(
      (r) => r.state.toUpperCase() === st || r.state.toUpperCase().startsWith(st),
    );
  }

  return JSON.stringify({
    periodLabel: period.label,
    preset,
    rows: filtered.slice(0, MAX_LIMIT),
    totals,
    rowCount: filtered.length,
  });
}

// ─────────────────────────────────────────────────────────────────
// Tool: query_nec1099_summary
// ─────────────────────────────────────────────────────────────────

interface QueryNec1099SummaryInput {
  year?: number;
}

async function queryNec1099Summary(
  input: QueryNec1099SummaryInput,
  session: SessionPayload,
): Promise<string> {
  const blocked = blockFieldEmployee(session, "query_nec1099_summary");
  if (blocked) return blocked;

  const nowYear = new Date().getUTCFullYear();
  const year =
    typeof input.year === "number" && Number.isFinite(input.year)
      ? Math.min(2100, Math.max(2000, Math.floor(input.year)))
      : nowYear;

  let rows;
  if (session.role === "vendor" && session.vendorId) {
    rows = await nec1099Rows({ year, vendorId: session.vendorId });
  } else if (session.role === "partner" && session.partnerId) {
    rows = await nec1099Rows({ year, payerPartnerId: session.partnerId });
  } else if (session.role === "admin") {
    rows = await nec1099Rows({ year });
  } else {
    return err("No org scope on this session.");
  }

  const totalNecPaid = rows.reduce((s, r) => s + Number(r.totalPaid), 0);

  return JSON.stringify({
    year,
    thresholdUsd: NEC_THRESHOLD_USD,
    recipientCount: rows.length,
    totalNecPaid: totalNecPaid.toFixed(2),
    rows: rows.slice(0, MAX_LIMIT).map((r) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      payerPartnerId: r.payerPartnerId,
      payerPartnerName: r.payerPartnerName,
      totalPaid: r.totalPaid,
      sharedEinWarning: r.sharedEinWarning,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────
// Public dispatcher
// ─────────────────────────────────────────────────────────────────

import {
  EXT_DATA_TOOL_NAMES,
  isExtDataTool,
  runExtDataTool,
} from "./data-tools-ext";
import {
  OPS_DATA_TOOL_NAMES,
  isOpsDataTool,
  runOpsDataTool,
} from "./data-tools-ops";
import {
  MARKET_DATA_TOOL_NAMES,
  isMarketDataTool,
  runMarketDataTool,
} from "./data-tools-market";

export const DATA_TOOL_NAMES = [
  "query_tickets",
  "query_gps_trail",
  "query_vendor_performance",
  "query_visits",
  "query_field_metrics",
  "query_invoice_summary",
  "query_sales_tax_by_state",
  "query_nec1099_summary",
  ...EXT_DATA_TOOL_NAMES,
  ...OPS_DATA_TOOL_NAMES,
  ...MARKET_DATA_TOOL_NAMES,
] as const;

export type DataToolName = (typeof DATA_TOOL_NAMES)[number];

export function isDataTool(name: string): name is DataToolName {
  return (DATA_TOOL_NAMES as readonly string[]).includes(name);
}

export async function runDataTool(
  name: DataToolName,
  input: unknown,
  session: SessionPayload,
): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>;
  if (isExtDataTool(name)) {
    return runExtDataTool(name, args, session);
  }
  if (isOpsDataTool(name)) {
    return runOpsDataTool(name, args, session);
  }
  if (isMarketDataTool(name)) {
    return runMarketDataTool(name, args, session);
  }
  switch (name) {
    case "query_tickets":
      return queryTickets(args as QueryTicketsInput, session);
    case "query_gps_trail":
      return queryGpsTrail(args as QueryGpsTrailInput, session);
    case "query_vendor_performance":
      return queryVendorPerformance(args as QueryVendorPerformanceInput, session);
    case "query_visits":
      return queryVisits(args as QueryVisitsInput, session);
    case "query_field_metrics":
      return queryFieldMetrics(args as QueryFieldMetricsInput, session);
    case "query_invoice_summary":
      return queryInvoiceSummary(args as QueryInvoiceSummaryInput, session);
    case "query_sales_tax_by_state":
      return querySalesTaxByState(args as QuerySalesTaxByStateInput, session);
    case "query_nec1099_summary":
      return queryNec1099Summary(args as QueryNec1099SummaryInput, session);
  }
}
