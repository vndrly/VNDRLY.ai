// AskV read-only tools — safety, sites, ops, hotlist, catalog, notifications.

import { and, asc, desc, eq, gte, ilike, inArray, isNull, sql } from "drizzle-orm";
import { vendorCatalogPartnerIds } from "../lib/partner-catalog-access";
import {
  db,
  safetyEventsTable,
  siteLocationsTable,
  notificationsTable,
  ticketsTable,
  gpsLogsTable,
  hotlistJobsTable,
  hotlistBidsTable,
  vendorWorkTypesTable,
  workTypesTable,
  partnerVendorWorkTypeApprovalsTable,
  employeeCertificationsTable,
  vendorPeopleTable,
  ticketCrewTable,
  ticketCheckInsTable,
  partnerContactsTable,
  ticketFlagsTable,
  siteVisitsTable,
  invoicesTable,
  accountingConnectionsTable,
  partnersTable,
  vendorsTable,
  siteWorkAssignmentsTable,
} from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { computeSafetyMetrics, loadSiteOperationalStatus } from "../lib/safety-metrics";
import {
  blockFieldEmployee,
  clampLimit,
  clampSinceDays,
  err,
  MAX_LIMIT,
  sinceDate,
  ticketScopeFilters,
} from "./data-tools-helpers";
import { LIVE_TRACKED_LIFECYCLE_STATES } from "@workspace/ticket-status-meta";
import { normalizePlateState } from "@workspace/plate-state";
import { summarizeGpsDistance } from "@workspace/map-utils";
import { estimateMapboxDrivingRoute } from "../lib/mapbox-routing";
import { approvedPartnersForVendor, vendorCanReadPartner, employeeCanReadSite } from "../lib/approved-partner-sites";
import { GateReportError, getGateReport } from "../lib/gate-report";

import { OPS_DATA_TOOL_NAMES } from "./tool-names";
export { OPS_DATA_TOOL_NAMES } from "./tool-names";

export type OpsDataToolName = (typeof OPS_DATA_TOOL_NAMES)[number];

export function isOpsDataTool(name: string): name is OpsDataToolName {
  return (OPS_DATA_TOOL_NAMES as readonly string[]).includes(name);
}

function safetyScope(session: SessionPayload) {
  if (session.role === "admin") return [];
  if (session.role === "partner" && session.partnerId) {
    return [eq(safetyEventsTable.partnerId, session.partnerId)];
  }
  if (session.role === "vendor" && session.vendorId) {
    return [eq(safetyEventsTable.vendorId, session.vendorId)];
  }
  if (session.role === "field_employee" && session.userId) {
    return [eq(safetyEventsTable.reportedByUserId, session.userId)];
  }
  return null;
}

async function querySafetyEvents(args: Record<string, unknown>, session: SessionPayload) {
  const scope = safetyScope(session);
  if (scope === null) return err("No org scope on this session.");
  const sinceDays = clampSinceDays(args.sinceDays);
  const limit = clampLimit(args.limit);
  const filters = [...scope, gte(safetyEventsTable.createdAt, sinceDate(sinceDays))];
  if (args.status) filters.push(eq(safetyEventsTable.status, String(args.status)));
  if (args.siteId) filters.push(eq(safetyEventsTable.siteLocationId, Number(args.siteId)));
  if (args.openOnly === true) {
    filters.push(inArray(safetyEventsTable.status, ["submitted", "under_review", "resolved"]));
  }
  if (args.countOnly === true) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(safetyEventsTable)
      .where(and(...filters));
    return JSON.stringify({ count: row?.count ?? 0 });
  }
  const rows = await db
    .select({
      id: safetyEventsTable.id,
      eventNumber: safetyEventsTable.eventNumber,
      eventType: safetyEventsTable.eventType,
      status: safetyEventsTable.status,
      title: safetyEventsTable.title,
      siteLocationId: safetyEventsTable.siteLocationId,
      isHighPotential: safetyEventsTable.isHighPotential,
      isStopWork: safetyEventsTable.isStopWork,
      isAnonymous: safetyEventsTable.isAnonymous,
      createdAt: safetyEventsTable.createdAt,
    })
    .from(safetyEventsTable)
    .where(and(...filters))
    .orderBy(desc(safetyEventsTable.createdAt))
    .limit(limit);
  const redacted = rows.map((r) =>
    r.isAnonymous && session.role !== "admin"
      ? { ...r, reporterLabel: "Anonymous field report" }
      : r,
  );
  return JSON.stringify({ rows: redacted, limit });
}

async function lookupSafetyMetrics(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "lookup_safety_metrics");
  if (blocked) return blocked;
  const siteId = args.siteId != null ? Number(args.siteId) : undefined;
  const metrics = await computeSafetyMetrics({
    partnerId: session.role === "partner" ? session.partnerId ?? undefined : undefined,
    vendorId: session.role === "vendor" ? session.vendorId ?? undefined : undefined,
    siteLocationId: Number.isFinite(siteId) ? siteId : undefined,
  });
  return JSON.stringify(metrics);
}

async function lookupSiteOperationalStatus(args: Record<string, unknown>, session: SessionPayload) {
  const siteId = Number(args.siteId);
  if (!Number.isFinite(siteId)) return err("siteId is required.");
  const status = await loadSiteOperationalStatus(siteId);
  if (!status) return err(`Site ${siteId} not found.`);
  if (!(await canReadSitePartner(session, status.partnerId, siteId))) {
    return err("Site not visible to your account.");
  }
  return JSON.stringify(status);
}

async function canReadSitePartner(session: SessionPayload, partnerId: number | null, siteId: number) {
  if (session.role === "admin") return true;
  if (session.role === "partner") return !!session.partnerId && session.partnerId === partnerId;
  if (session.role === "vendor" && session.vendorId) return vendorCanReadPartner(session.vendorId, partnerId);
  if (session.role === "field_employee" && session.userId) {
    const [person] = await db.select({ id: vendorPeopleTable.id, vendorId: vendorPeopleTable.vendorId }).from(vendorPeopleTable)
      .where(and(eq(vendorPeopleTable.userId, session.userId), eq(vendorPeopleTable.isActive, true), isNull(vendorPeopleTable.deletedAt))).limit(1);
    return !!person && employeeCanReadSite(person.id, person.vendorId, partnerId, siteId);
  }
  return false;
}

async function querySiteLocations(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "query_site_locations");
  if (blocked) return blocked;
  const limit = clampLimit(args.limit);
  const filters = [eq(siteLocationsTable.hidden, false)];
  if (session.role === "partner" && session.partnerId) {
    filters.push(eq(siteLocationsTable.partnerId, session.partnerId));
  } else if (session.role === "vendor" && session.vendorId) {
    filters.push(inArray(siteLocationsTable.partnerId, approvedPartnersForVendor(session.vendorId)));
  } else if (session.role !== "admin") {
    return err("No org scope on this session.");
  }
  if (args.inactiveOnly === true) {
    filters.push(eq(siteLocationsTable.isActive, false));
  }
  if (args.search) {
    filters.push(ilike(siteLocationsTable.name, `%${String(args.search)}%`));
  }
  const rows = await db
    .select({
      id: siteLocationsTable.id,
      name: siteLocationsTable.name,
      siteCode: siteLocationsTable.siteCode,
      status: siteLocationsTable.status,
      isActive: siteLocationsTable.isActive,
      afe: siteLocationsTable.afe,
      partnerId: siteLocationsTable.partnerId,
    })
    .from(siteLocationsTable)
    .where(and(...filters))
    .orderBy(siteLocationsTable.name)
    .limit(limit);
  return JSON.stringify({ rows, limit });
}

async function lookupSiteDetail(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "lookup_site_detail");
  if (blocked) return blocked;
  const siteId = Number(args.siteId);
  if (!Number.isFinite(siteId)) return err("siteId is required.");
  const [site] = await db
    .select()
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteId))
    .limit(1);
  if (!site) return err(`Site ${siteId} not found.`);
  if (!(await canReadSitePartner(session, site.partnerId, siteId))) {
    return err("Site not visible to your account.");
  }
  const assignments = await db
    .select({
      vendorId: siteWorkAssignmentsTable.vendorId,
      vendorName: vendorsTable.name,
    })
    .from(siteWorkAssignmentsTable)
    .innerJoin(vendorsTable, eq(siteWorkAssignmentsTable.vendorId, vendorsTable.id))
    .where(eq(siteWorkAssignmentsTable.siteLocationId, siteId))
    .limit(20);
  const opStatus = await loadSiteOperationalStatus(siteId);
  return JSON.stringify({ site: opStatus ?? site, assignments });
}

async function queryNotifications(args: Record<string, unknown>, session: SessionPayload) {
  if (!session.userId) return err("Must be signed in.");
  const limit = clampLimit(args.limit ?? 20);
  const filters = [eq(notificationsTable.userId, session.userId)];
  if (args.unreadOnly !== false) filters.push(eq(notificationsTable.isRead, false));
  const rows = await db
    .select({
      id: notificationsTable.id,
      type: notificationsTable.type,
      title: notificationsTable.title,
      body: notificationsTable.body,
      link: notificationsTable.link,
      isRead: notificationsTable.isRead,
      createdAt: notificationsTable.createdAt,
    })
    .from(notificationsTable)
    .where(and(...filters))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);
  return JSON.stringify({ rows, limit });
}

async function queryAttentionBriefing(args: Record<string, unknown>, session: SessionPayload) {
  if (!session.userId || !session.role) return err("Must be signed in.");
  const sinceDays = clampSinceDays(args.sinceDays ?? 30);
  const limit = clampLimit(args.limit ?? 8);
  const now = new Date();
  const since = sinceDate(sinceDays);
  const ticketScope = ticketScopeFilters(session);
  if (ticketScope === null) return err("No org scope on this session.");

  const openTicketFilters = [
    ...ticketScope,
    sql`${ticketsTable.status} NOT IN ('cancelled','funds_dispersed','denied','completed','closed')`,
  ];
  const staleTicketFilters = [
    ...openTicketFilters,
    sql`${ticketsTable.updatedAt} < now() - interval '3 days'`,
  ];
  const dueTicketFilters = [
    ...openTicketFilters,
    sql`${ticketsTable.scheduledStartAt} IS NOT NULL`,
    sql`${ticketsTable.scheduledStartAt} <= now() + interval '24 hours'`,
  ];

  const [
    unreadNotifications,
    openTickets,
    staleTickets,
    dueTickets,
    pendingReviewTickets,
    liveCrewTickets,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, session.userId), eq(notificationsTable.isRead, false))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ticketsTable)
      .where(and(...(openTicketFilters as Parameters<typeof and>))),
    db
      .select({
        id: ticketsTable.id,
        status: ticketsTable.status,
        lifecycleState: ticketsTable.lifecycleState,
        scheduledStartAt: ticketsTable.scheduledStartAt,
        updatedAt: ticketsTable.updatedAt,
        siteLocationId: ticketsTable.siteLocationId,
      })
      .from(ticketsTable)
      .where(and(...(staleTicketFilters as Parameters<typeof and>)))
      .orderBy(asc(ticketsTable.updatedAt))
      .limit(limit),
    db
      .select({
        id: ticketsTable.id,
        status: ticketsTable.status,
        lifecycleState: ticketsTable.lifecycleState,
        scheduledStartAt: ticketsTable.scheduledStartAt,
        siteLocationId: ticketsTable.siteLocationId,
      })
      .from(ticketsTable)
      .where(and(...(dueTicketFilters as Parameters<typeof and>)))
      .orderBy(asc(ticketsTable.scheduledStartAt))
      .limit(limit),
    db
      .select({
        id: ticketsTable.id,
        status: ticketsTable.status,
        lifecycleState: ticketsTable.lifecycleState,
        updatedAt: ticketsTable.updatedAt,
        siteLocationId: ticketsTable.siteLocationId,
      })
      .from(ticketsTable)
      .where(and(...(ticketScope as Parameters<typeof and>), eq(ticketsTable.status, "pending_review")))
      .orderBy(asc(ticketsTable.updatedAt))
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ticketsTable)
      .where(
        and(
          ...(ticketScope as Parameters<typeof and>),
          inArray(ticketsTable.lifecycleState, [...LIVE_TRACKED_LIFECYCLE_STATES]),
          sql`${ticketsTable.status} NOT IN ('cancelled','funds_dispersed','denied')`,
        ),
      ),
  ]);

  const briefing: Record<string, unknown> = {
    generatedAt: now.toISOString(),
    sinceDays,
    role: session.role,
    unreadNotifications: Number(unreadNotifications[0]?.count ?? 0),
    tickets: {
      openCount: Number(openTickets[0]?.count ?? 0),
      dueNext24h: dueTickets,
      staleMoreThan3Days: staleTickets,
      pendingReview: pendingReviewTickets,
      liveCrewCount: Number(liveCrewTickets[0]?.count ?? 0),
    },
    recommendedOrder: [
      "Unread notifications",
      "Tickets due in the next 24 hours",
      "Pending review tickets",
      "Open tickets stale more than 3 days",
      "Live crew / active route exceptions",
    ],
  };

  if (session.role !== "field_employee") {
    const invoiceFilters = [
      sql`${invoicesTable.status} NOT IN ('paid','cancelled')`,
      gte(invoicesTable.createdAt, since),
    ];
    if (session.role === "vendor" && session.vendorId) {
      invoiceFilters.push(eq(invoicesTable.vendorId, session.vendorId));
    } else if (session.role === "partner" && session.partnerId) {
      invoiceFilters.push(eq(invoicesTable.partnerId, session.partnerId));
    }
    const safetyScope = (() => {
      if (session.role === "admin") return [];
      if (session.role === "partner" && session.partnerId) return [eq(safetyEventsTable.partnerId, session.partnerId)];
      if (session.role === "vendor" && session.vendorId) return [eq(safetyEventsTable.vendorId, session.vendorId)];
      return null;
    })();
    const [openInvoices, pastDueInvoices, openSafetyEvents, expiringCerts] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoicesTable)
        .where(and(...(invoiceFilters as Parameters<typeof and>))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoicesTable)
        .where(
          and(
            ...(invoiceFilters as Parameters<typeof and>),
            sql`${invoicesTable.dueDate} IS NOT NULL`,
            sql`${invoicesTable.dueDate} < now()`,
          ),
        ),
      safetyScope
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(safetyEventsTable)
            .where(and(...safetyScope, sql`${safetyEventsTable.status} NOT IN ('closed','resolved')`))
        : Promise.resolve([{ count: 0 }]),
      session.role === "partner"
        ? Promise.resolve([{ count: 0 }])
        : db
            .select({ count: sql<number>`count(*)::int` })
            .from(employeeCertificationsTable)
            .innerJoin(vendorPeopleTable, eq(employeeCertificationsTable.employeeId, vendorPeopleTable.id))
            .where(
              and(
                isNull(employeeCertificationsTable.deletedAt),
                gte(employeeCertificationsTable.expirationDate, now.toISOString().slice(0, 10)),
                sql`${employeeCertificationsTable.expirationDate} <= ${(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10)}`,
                session.role === "vendor" && session.vendorId
                  ? eq(vendorPeopleTable.vendorId, session.vendorId)
                  : sql`true`,
              ),
            ),
    ]);
    briefing.office = {
      openInvoices: Number(openInvoices[0]?.count ?? 0),
      pastDueInvoices: Number(pastDueInvoices[0]?.count ?? 0),
      openSafetyEvents: Number(openSafetyEvents[0]?.count ?? 0),
      certificationsExpiringWithin30Days: Number(expiringCerts[0]?.count ?? 0),
    };
    briefing.recommendedOrder = [
      ...(briefing.recommendedOrder as string[]),
      "Open safety events",
      "Past-due invoices",
      "Expiring crew certifications",
    ];
  }

  return JSON.stringify(briefing);
}

async function queryLiveCrew(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "query_live_crew");
  if (blocked) return blocked;
  const limit = clampLimit(args.limit);
  const filters = [
    inArray(ticketsTable.lifecycleState, [...LIVE_TRACKED_LIFECYCLE_STATES]),
    sql`${ticketsTable.status} NOT IN ('cancelled','funds_dispersed','denied')`,
  ];
  if (session.role === "partner" && session.partnerId) {
    filters.push(
      sql`${ticketsTable.siteLocationId} IN (SELECT id FROM site_locations WHERE partner_id = ${session.partnerId})`,
    );
  } else if (session.role === "vendor" && session.vendorId) {
    filters.push(eq(ticketsTable.vendorId, session.vendorId));
  }
  if (args.siteId) filters.push(eq(ticketsTable.siteLocationId, Number(args.siteId)));
  const rows = await db
    .select({
      ticketId: ticketsTable.id,
      lifecycleState: ticketsTable.lifecycleState,
      status: ticketsTable.status,
      siteLocationId: ticketsTable.siteLocationId,
      vendorId: ticketsTable.vendorId,
      siteName: siteLocationsTable.name,
    })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(and(...filters))
    .orderBy(desc(ticketsTable.updatedAt))
    .limit(limit);
  return JSON.stringify({ rows, limit });
}

function canUseCrewOps(session: SessionPayload): boolean {
  if (session.role === "admin" || session.role === "partner" || session.role === "vendor") return true;
  return session.role === "field_employee" && (session.vendorRole === "foreman" || session.vendorRole === "both");
}

function milesBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const rMiles = 3958.7613;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * rMiles * Math.asin(Math.sqrt(h));
}

function normalizeEmployeeSearch(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

async function resolveCrewMember(args: Record<string, unknown>, session: SessionPayload) {
  const filters = [
    eq(vendorPeopleTable.isActive, true),
    isNull(vendorPeopleTable.deletedAt),
  ];
  const crewEmployeeId = Number(args.crewEmployeeId ?? args.employeeId);
  if (Number.isFinite(crewEmployeeId) && crewEmployeeId > 0) {
    filters.push(eq(vendorPeopleTable.id, Math.floor(crewEmployeeId)));
  } else {
    const search = normalizeEmployeeSearch(args.crewMemberName ?? args.employeeName ?? args.name);
    if (!search) return { error: "crewEmployeeId or crewMemberName is required." } as const;
    const needle = `%${search}%`;
    filters.push(sql`(
      LOWER(TRIM(COALESCE(${vendorPeopleTable.firstName}, '') || ' ' || COALESCE(${vendorPeopleTable.lastName}, ''))) LIKE ${needle}
      OR LOWER(${vendorPeopleTable.email}) LIKE ${needle}
    )`);
  }
  if ((session.role === "vendor" || session.role === "field_employee") && session.vendorId) {
    filters.push(eq(vendorPeopleTable.vendorId, session.vendorId));
  } else if (session.role === "partner" && session.partnerId) {
    filters.push(sql`EXISTS (
      SELECT 1
      FROM ticket_crew tc
      INNER JOIN tickets t ON t.id = tc.ticket_id
      INNER JOIN site_locations sl ON sl.id = t.site_location_id
      WHERE tc.employee_id = ${vendorPeopleTable.id}
        AND tc.removed_at IS NULL
        AND sl.partner_id = ${session.partnerId}
    )`);
  } else if (session.role !== "admin") {
    return { error: "No crew scope on this session." } as const;
  }

  const matches = await db
    .select({
      id: vendorPeopleTable.id,
      vendorId: vendorPeopleTable.vendorId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      email: vendorPeopleTable.email,
      vendorRole: vendorPeopleTable.vendorRole,
      userId: vendorPeopleTable.userId,
    })
    .from(vendorPeopleTable)
    .where(and(...filters))
    .orderBy(vendorPeopleTable.firstName, vendorPeopleTable.lastName)
    .limit(5);

  if (matches.length === 0) return { error: "Crew member not found in your scope." } as const;
  if (matches.length > 1) {
    return {
      error: "Multiple crew members matched. Ask which one.",
      matches: matches.map((m) => ({
        crewEmployeeId: m.id,
        name: `${m.firstName} ${m.lastName}`.trim(),
        email: m.email,
      })),
    } as const;
  }
  return { employee: matches[0] } as const;
}

async function loadEmployeeActiveTicket(employeeId: number, session: SessionPayload, explicitTicketId?: number) {
  const scope = ticketScopeFilters(session);
  if (scope === null) return null;
  const filters: unknown[] = [
    ...scope,
    sql`${ticketsTable.status} NOT IN ('cancelled','funds_dispersed','denied','completed','closed')`,
  ];
  if (Number.isFinite(explicitTicketId) && explicitTicketId! > 0) {
    filters.push(eq(ticketsTable.id, Math.floor(explicitTicketId!)));
  } else {
    filters.push(
      sql`(
        ${ticketsTable.fieldEmployeeId} = ${employeeId}
        OR EXISTS (
          SELECT 1 FROM ticket_crew tc
          WHERE tc.ticket_id = ${ticketsTable.id}
            AND tc.employee_id = ${employeeId}
            AND tc.removed_at IS NULL
        )
      )`,
    );
  }
  const [ticket] = await db
    .select({
      ticketId: ticketsTable.id,
      status: ticketsTable.status,
      lifecycleState: ticketsTable.lifecycleState,
      siteLocationId: ticketsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      siteLatitude: siteLocationsTable.latitude,
      siteLongitude: siteLocationsTable.longitude,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
      scheduledStartAt: ticketsTable.scheduledStartAt,
      checkInTime: ticketsTable.checkInTime,
      checkOutTime: ticketsTable.checkOutTime,
      enRouteAt: ticketsTable.enRouteAt,
      onLocationAt: ticketsTable.onLocationAt,
    })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(and(...(filters as Parameters<typeof and>)))
    .orderBy(desc(ticketsTable.updatedAt))
    .limit(1);
  return ticket ?? null;
}

async function loadLatestGps(ticketId: number) {
  const [last] = await db
    .select({
      latitude: gpsLogsTable.latitude,
      longitude: gpsLogsTable.longitude,
      eventType: gpsLogsTable.eventType,
      speedMps: gpsLogsTable.speedMps,
      batteryLevel: gpsLogsTable.batteryLevel,
      recordedAt: gpsLogsTable.recordedAt,
    })
    .from(gpsLogsTable)
    .where(eq(gpsLogsTable.ticketId, ticketId))
    .orderBy(desc(gpsLogsTable.recordedAt))
    .limit(1);
  return last ?? null;
}

async function lookupCrewMemberStatus(args: Record<string, unknown>, session: SessionPayload) {
  if (!canUseCrewOps(session)) return err("Crew status lookup is available to vendor admins, foremen, partners, and admins.");
  const resolved = await resolveCrewMember(args, session);
  if ("error" in resolved) return JSON.stringify(resolved);
  const ticket = await loadEmployeeActiveTicket(resolved.employee.id, session, Number(args.ticketId));
  if (!ticket) {
    return JSON.stringify({
      employee: {
        crewEmployeeId: resolved.employee.id,
        name: `${resolved.employee.firstName} ${resolved.employee.lastName}`.trim(),
        email: resolved.employee.email,
      },
      activeTicket: null,
      status: "No active ticket found in scope.",
    });
  }
  const lastGps = await loadLatestGps(ticket.ticketId);
  const distanceToSiteMiles =
    lastGps && ticket.siteLatitude != null && ticket.siteLongitude != null
      ? milesBetween(lastGps, { latitude: ticket.siteLatitude, longitude: ticket.siteLongitude })
      : null;
  return JSON.stringify({
    employee: {
      crewEmployeeId: resolved.employee.id,
      name: `${resolved.employee.firstName} ${resolved.employee.lastName}`.trim(),
      email: resolved.employee.email,
    },
    activeTicket: ticket,
    lastGps,
    distanceToSiteMiles,
    locationSource: "ticket_gps_trail",
    note: "Current schema stores GPS by ticket, not by employee. If multiple crew members are on this ticket, location is the active ticket trail.",
  });
}

async function queryCrewEta(args: Record<string, unknown>, session: SessionPayload) {
  if (!canUseCrewOps(session)) return err("Crew ETA lookup is available to vendor admins, foremen, partners, and admins.");
  const resolved = await resolveCrewMember(args, session);
  if ("error" in resolved) return JSON.stringify(resolved);
  const ticket = await loadEmployeeActiveTicket(resolved.employee.id, session, Number(args.ticketId));
  if (!ticket) return err("No active ticket found for that crew member in your scope.");
  const lastGps = await loadLatestGps(ticket.ticketId);
  if (!lastGps) return err(`No GPS points found for ticket ${ticket.ticketId}.`);
  const gpsAgeMs = Date.now() - new Date(lastGps.recordedAt).getTime();
  if (!Number.isFinite(gpsAgeMs) || gpsAgeMs < -60_000 || gpsAgeMs > 15 * 60_000) return err("GPS is stale; a current arrival estimate is unavailable.");
  if (ticket.lifecycleState !== "en_route") return JSON.stringify({ ticketId: ticket.ticketId, lifecycleState: ticket.lifecycleState, etaMinutes: null, note: "Crew is not currently en route." });
  const route = await estimateMapboxDrivingRoute({ origin: lastGps, destination: { latitude: ticket.siteLatitude, longitude: ticket.siteLongitude } });
  if (!route.ok) return JSON.stringify({ error: route.message, etaMinutes: null });
  const distanceToSiteMiles = route.distanceMiles;
  const speedMph = lastGps.speedMps && lastGps.speedMps > 0
    ? lastGps.speedMps * 2.2369362921
    : null;
  const etaMinutes = route.durationMinutes;
  const etaAt = new Date(Date.now() + etaMinutes * 60_000);
  return JSON.stringify({
    employee: {
      crewEmployeeId: resolved.employee.id,
      name: `${resolved.employee.firstName} ${resolved.employee.lastName}`.trim(),
    },
    ticketId: ticket.ticketId,
    siteName: ticket.siteName,
    lastGps,
    distanceToSiteMiles,
    speedMph,
    etaMinutes,
    etaAt,
    estimateBasis: "mapbox_road_route_estimate",
    locationSource: "ticket_gps_trail",
  });
}

async function queryCrewRouteSummary(args: Record<string, unknown>, session: SessionPayload) {
  if (!canUseCrewOps(session)) return err("Crew route summary is available to vendor admins, foremen, partners, and admins.");
  let ticketId = Number(args.ticketId);
  let employee: { id: number; firstName: string; lastName: string; email: string } | null = null;
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    const resolved = await resolveCrewMember(args, session);
    if ("error" in resolved) return JSON.stringify(resolved);
    employee = resolved.employee;
    const ticket = await loadEmployeeActiveTicket(resolved.employee.id, session);
    if (!ticket) return err("No active ticket found for that crew member in your scope.");
    ticketId = ticket.ticketId;
  }
  const scope = ticketScopeFilters(session);
  if (scope === null) return err("No org scope on this session.");
  const [ticket] = await db
    .select({
      ticketId: ticketsTable.id,
      siteName: siteLocationsTable.name,
      siteLatitude: siteLocationsTable.latitude,
      siteLongitude: siteLocationsTable.longitude,
      enRouteAt: ticketsTable.enRouteAt,
      onLocationAt: ticketsTable.onLocationAt,
      checkInTime: ticketsTable.checkInTime,
      checkOutTime: ticketsTable.checkOutTime,
    })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(and(eq(ticketsTable.id, Math.floor(ticketId)), ...(scope as Parameters<typeof and>)))
    .limit(1);
  if (!ticket) return err(`Ticket ${Math.floor(ticketId)} not visible to your account.`);

  const points = await db
    .select({
      latitude: gpsLogsTable.latitude,
      longitude: gpsLogsTable.longitude,
      eventType: gpsLogsTable.eventType,
      speedMps: gpsLogsTable.speedMps,
      batteryLevel: gpsLogsTable.batteryLevel,
      recordedAt: gpsLogsTable.recordedAt,
    })
    .from(gpsLogsTable)
    .where(eq(gpsLogsTable.ticketId, Math.floor(ticketId)))
    .orderBy(asc(gpsLogsTable.recordedAt))
    .limit(500);
  const distance = summarizeGpsDistance(points.map((point) => ({ ...point, ticketId: Math.floor(ticketId) })));
  const first = points[0] ?? null;
  const last = points[points.length - 1] ?? null;
  const durationMinutes =
    first && last
      ? Math.round((new Date(last.recordedAt).getTime() - new Date(first.recordedAt).getTime()) / 60_000)
      : null;
  const [activeCheckIn] = employee
    ? await db
        .select({
          checkInAt: ticketCheckInsTable.checkInAt,
          checkOutAt: ticketCheckInsTable.checkOutAt,
          source: ticketCheckInsTable.source,
        })
        .from(ticketCheckInsTable)
        .where(and(
          eq(ticketCheckInsTable.ticketId, Math.floor(ticketId)),
          eq(ticketCheckInsTable.employeeId, employee.id),
          isNull(ticketCheckInsTable.checkOutAt),
        ))
        .orderBy(desc(ticketCheckInsTable.checkInAt))
        .limit(1)
    : [];
  return JSON.stringify({
    ticket,
    employee: employee
      ? {
          crewEmployeeId: employee.id,
          name: `${employee.firstName} ${employee.lastName}`.trim(),
          email: employee.email,
        }
      : null,
    points: points.length,
    first,
    last,
    routeMilesApprox: distance.segments ? Math.round(distance.meters / 1609.344 * 10) / 10 : null,
    excludedGpsSegments: distance.gaps,
    potentiallyTruncated: points.length === 500,
    mileageBasis: "Sampled ticket GPS; not odometer mileage or a complete employee day total.",
    durationMinutes,
    activeCheckIn: activeCheckIn ?? null,
    locationSource: "ticket_gps_trail",
  });
}

function parseCoordinate(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseMileage(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type AskVRouteActionLink = {
  label: string;
  url: string;
};

export function buildRouteActionLinks(destination: {
  ticketId?: unknown;
  siteId?: unknown;
  siteLatitude?: unknown;
  siteLongitude?: unknown;
}): AskVRouteActionLink[] {
  const actions: AskVRouteActionLink[] = [];
  const ticketId = Number(destination.ticketId);
  const siteId = Number(destination.siteId);
  const latitude = parseCoordinate(destination.siteLatitude);
  const longitude = parseCoordinate(destination.siteLongitude);

  if (Number.isFinite(ticketId) && ticketId > 0) {
    actions.push({
      label: `Open ticket #${Math.floor(ticketId)}`,
      url: `/tickets/${Math.floor(ticketId)}`,
    });
  }

  if (Number.isFinite(siteId) && siteId > 0) {
    actions.push({
      label: "Open map",
      url: `/site-map?siteId=${encodeURIComponent(String(Math.floor(siteId)))}`,
    });
  } else {
    actions.push({ label: "Open map", url: "/crew-map" });
  }

  if (latitude != null && longitude != null) {
    actions.push({
      label: "Start navigation",
      url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitude},${longitude}`)}`,
    });
  }

  return actions;
}

async function queryTicketLoggedMiles(args: Record<string, unknown>, session: SessionPayload) {
  const ticketId = Number(args.ticketId);
  if (!Number.isFinite(ticketId) || ticketId <= 0) return err("ticketId is required.");
  const scope = ticketScopeFilters(session);
  if (scope === null) return err("No org scope on this session.");

  const [ticket] = await db
    .select({
      ticketId: ticketsTable.id,
      status: ticketsTable.status,
      lifecycleState: ticketsTable.lifecycleState,
      siteId: siteLocationsTable.id,
      siteName: siteLocationsTable.name,
      siteLatitude: siteLocationsTable.latitude,
      siteLongitude: siteLocationsTable.longitude,
      enRouteAt: ticketsTable.enRouteAt,
      onLocationAt: ticketsTable.onLocationAt,
      checkInTime: ticketsTable.checkInTime,
      checkOutTime: ticketsTable.checkOutTime,
      startingMileage: ticketsTable.startingMileage,
      endingMileage: ticketsTable.endingMileage,
    })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(and(eq(ticketsTable.id, Math.floor(ticketId)), ...(scope as Parameters<typeof and>)))
    .limit(1);
  if (!ticket) return err(`Ticket ${Math.floor(ticketId)} not visible to your account.`);

  const points = await db
    .select({
      latitude: gpsLogsTable.latitude,
      longitude: gpsLogsTable.longitude,
      eventType: gpsLogsTable.eventType,
      speedMps: gpsLogsTable.speedMps,
      batteryLevel: gpsLogsTable.batteryLevel,
      recordedAt: gpsLogsTable.recordedAt,
    })
    .from(gpsLogsTable)
    .where(eq(gpsLogsTable.ticketId, Math.floor(ticketId)))
    .orderBy(asc(gpsLogsTable.recordedAt))
    .limit(500);

  let gpsMiles = 0;
  for (let i = 1; i < points.length; i += 1) {
    gpsMiles += milesBetween(points[i - 1], points[i]);
  }
  const startingMileage = parseMileage(ticket.startingMileage);
  const endingMileage = parseMileage(ticket.endingMileage);
  const odometerMiles =
    startingMileage != null && endingMileage != null && endingMileage >= startingMileage
      ? Math.round((endingMileage - startingMileage) * 10) / 10
      : null;
  const first = points[0] ?? null;
  const last = points[points.length - 1] ?? null;
  const gpsDurationMinutes =
    first && last
      ? Math.round((new Date(last.recordedAt).getTime() - new Date(first.recordedAt).getTime()) / 60_000)
      : null;

  return JSON.stringify({
    ticket,
    loggedMiles: {
      odometerMiles,
      startingMileage,
      endingMileage,
      gpsRouteMilesApprox: Math.round(gpsMiles * 10) / 10,
      basis: odometerMiles != null ? "odometer" : points.length > 1 ? "gps_trail" : "not_available",
    },
    gpsTrail: {
      points: points.length,
      first,
      last,
      durationMinutes: gpsDurationMinutes,
    },
    locationSource: "ticket_gps_trail",
  });
}

async function loadShopOrigin(session: SessionPayload) {
  if ((session.role === "vendor" || session.role === "field_employee") && session.vendorId) {
    const [vendor] = await db
      .select({
        id: vendorsTable.id,
        name: vendorsTable.name,
        latitude: vendorsTable.latitude,
        longitude: vendorsTable.longitude,
        physicalAddress: vendorsTable.physicalAddress,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, session.vendorId))
      .limit(1);
    if (!vendor) return { error: "Vendor shop not found for this session." } as const;
    const latitude = parseCoordinate(vendor.latitude);
    const longitude = parseCoordinate(vendor.longitude);
    if (latitude == null || longitude == null) {
      return { error: "Vendor shop coordinates are not configured yet." } as const;
    }
    return {
      origin: {
        latitude,
        longitude,
        source: "vendor_shop" as const,
        vendorId: vendor.id,
        vendorName: vendor.name,
        address: vendor.physicalAddress,
      },
    } as const;
  }
  return { error: "Shop-origin routing is currently available for vendor and field employee sessions with configured vendor coordinates." } as const;
}

function loadCurrentOrigin(args: Record<string, unknown>) {
  const currentLatitude = parseCoordinate(args.currentLatitude);
  const currentLongitude = parseCoordinate(args.currentLongitude);
  if (currentLatitude == null || currentLongitude == null) {
    return { error: "currentLatitude and currentLongitude are required for current-location routing." } as const;
  }
  return {
    origin: {
      latitude: currentLatitude,
      longitude: currentLongitude,
      source: "current_location" as const,
      accuracyMeters: parseCoordinate(args.accuracyMeters),
      capturedAt: typeof args.capturedAt === "string" ? args.capturedAt : null,
    },
  } as const;
}

async function loadMapOrigin(args: Record<string, unknown>, session: SessionPayload) {
  const originKind = args.origin === "shop" ? "shop" : "current_location";
  if (originKind === "shop") return loadShopOrigin(session);
  return loadCurrentOrigin(args);
}

async function loadRouteDestination(args: Record<string, unknown>, session: SessionPayload) {
  const scope = ticketScopeFilters(session);
  if (scope === null) return { error: "No org scope on this session." } as const;

  const ticketId = Number(args.ticketId);
  if (Number.isFinite(ticketId) && ticketId > 0) {
    const [ticket] = await db
      .select({
        ticketId: ticketsTable.id,
        status: ticketsTable.status,
        lifecycleState: ticketsTable.lifecycleState,
        scheduledStartAt: ticketsTable.scheduledStartAt,
        siteId: siteLocationsTable.id,
        siteName: siteLocationsTable.name,
        siteLatitude: siteLocationsTable.latitude,
        siteLongitude: siteLocationsTable.longitude,
      })
      .from(ticketsTable)
      .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
      .where(and(eq(ticketsTable.id, Math.floor(ticketId)), ...(scope as Parameters<typeof and>)))
      .limit(1);
    if (!ticket) return { error: `Ticket ${Math.floor(ticketId)} not visible to your account.` } as const;
    return { destination: ticket, basis: "ticket" as const };
  }

  const siteId = Number(args.siteId);
  if (Number.isFinite(siteId) && siteId > 0) {
    const filters = [eq(siteLocationsTable.id, Math.floor(siteId)), eq(siteLocationsTable.hidden, false)];
    if (session.role === "partner" && session.partnerId) {
      filters.push(eq(siteLocationsTable.partnerId, session.partnerId));
    } else if (session.role === "vendor" && session.vendorId) {
      filters.push(sql`${siteLocationsTable.id} IN (
        SELECT site_location_id FROM site_work_assignments WHERE vendor_id = ${session.vendorId}
      )`);
    } else if (session.role === "field_employee" && session.vendorPeopleId) {
      filters.push(sql`EXISTS (
        SELECT 1
        FROM tickets t
        LEFT JOIN ticket_crew tc ON tc.ticket_id = t.id AND tc.removed_at IS NULL
        WHERE t.site_location_id = ${siteLocationsTable.id}
          AND (t.field_employee_id = ${session.vendorPeopleId} OR tc.employee_id = ${session.vendorPeopleId})
      )`);
    } else if (session.role !== "admin") {
      return { error: "No site scope on this session." } as const;
    }
    const [site] = await db
      .select({
        ticketId: sql<number | null>`null`,
        status: sql<string | null>`null`,
        lifecycleState: sql<string | null>`null`,
        scheduledStartAt: sql<Date | null>`null`,
        siteId: siteLocationsTable.id,
        siteName: siteLocationsTable.name,
        siteLatitude: siteLocationsTable.latitude,
        siteLongitude: siteLocationsTable.longitude,
      })
      .from(siteLocationsTable)
      .where(and(...(filters as Parameters<typeof and>)))
      .limit(1);
    if (!site) return { error: `Site ${Math.floor(siteId)} not visible to your account.` } as const;
    return { destination: site, basis: "site" as const };
  }

  if (session.role !== "field_employee" || !session.vendorPeopleId) {
    return { error: "ticketId or siteId is required." } as const;
  }

  const [nextTicket] = await db
    .select({
      ticketId: ticketsTable.id,
      status: ticketsTable.status,
      lifecycleState: ticketsTable.lifecycleState,
      scheduledStartAt: ticketsTable.scheduledStartAt,
      siteId: siteLocationsTable.id,
      siteName: siteLocationsTable.name,
      siteLatitude: siteLocationsTable.latitude,
      siteLongitude: siteLocationsTable.longitude,
    })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(and(
      ...(scope as Parameters<typeof and>),
      sql`${ticketsTable.status} NOT IN ('cancelled','funds_dispersed','denied','completed','closed')`,
    ))
    .orderBy(sql`${ticketsTable.scheduledStartAt} NULLS LAST`, desc(ticketsTable.updatedAt))
    .limit(1);
  if (!nextTicket) return { error: "No upcoming assigned ticket found in your scope." } as const;
  return { destination: nextTicket, basis: "next_ticket" as const };
}

async function lookupMapOrigin(args: Record<string, unknown>, session: SessionPayload) {
  const loaded = await loadMapOrigin(args, session);
  if ("error" in loaded) return JSON.stringify(loaded);
  return JSON.stringify({ ok: true, origin: loaded.origin });
}

async function estimateDrivingRoute(args: Record<string, unknown>, session: SessionPayload) {
  const loadedOrigin = await loadMapOrigin(args, session);
  if ("error" in loadedOrigin) return JSON.stringify(loadedOrigin);
  const origin = loadedOrigin.origin;
  const loaded = await loadRouteDestination(args, session);
  if ("error" in loaded) return JSON.stringify(loaded);

  const route = await estimateMapboxDrivingRoute({
    origin,
    destination: {
      latitude: loaded.destination.siteLatitude,
      longitude: loaded.destination.siteLongitude,
    },
  });
  if (!route.ok) {
    return JSON.stringify({
      ok: false,
      error: route.message,
      errorCode: route.errorCode,
      destination: loaded.destination,
      basis: loaded.basis,
      actions: buildRouteActionLinks(loaded.destination),
    });
  }

  return JSON.stringify({
    ok: true,
    basis: loaded.basis,
    origin,
    destination: loaded.destination,
    route,
    actions: buildRouteActionLinks(loaded.destination),
  });
}

async function queryTicketRouteEta(args: Record<string, unknown>, session: SessionPayload) {
  const ticketId = Number(args.ticketId);
  if (!Number.isFinite(ticketId) || ticketId <= 0) return err("ticketId is required.");
  return estimateDrivingRoute({ ...args, ticketId: Math.floor(ticketId) }, session);
}

async function queryTicketMileageAudit(args: Record<string, unknown>, session: SessionPayload) {
  const ticketId = Number(args.ticketId);
  if (!Number.isFinite(ticketId) || ticketId <= 0) return err("ticketId is required.");

  const logged = JSON.parse(await queryTicketLoggedMiles({ ticketId: Math.floor(ticketId) }, session)) as Record<string, unknown>;
  if (typeof logged.error === "string") return JSON.stringify(logged);

  const routeArgs: Record<string, unknown> = { ...args, ticketId: Math.floor(ticketId) };
  let expectedRoute: unknown = null;
  const originKind = routeArgs.origin === "shop" ? "shop" : "current_location";
  const hasCurrent =
    parseCoordinate(routeArgs.currentLatitude) != null &&
    parseCoordinate(routeArgs.currentLongitude) != null;
  if (originKind === "shop" || hasCurrent) {
    expectedRoute = JSON.parse(await estimateDrivingRoute(routeArgs, session));
  }

  const loggedMiles = logged.loggedMiles as
    | { odometerMiles?: unknown; gpsRouteMilesApprox?: unknown; basis?: unknown }
    | undefined;
  const odometerMiles = parseMileage(loggedMiles?.odometerMiles);
  const gpsRouteMilesApprox = parseMileage(loggedMiles?.gpsRouteMilesApprox);
  const expectedMiles =
    expectedRoute &&
    typeof expectedRoute === "object" &&
    "route" in expectedRoute &&
    (expectedRoute as { route?: { distanceMiles?: unknown } }).route
      ? parseMileage((expectedRoute as { route: { distanceMiles?: unknown } }).route.distanceMiles)
      : null;
  const bestLoggedMiles = odometerMiles ?? gpsRouteMilesApprox;
  const varianceMiles =
    bestLoggedMiles != null && expectedMiles != null
      ? Math.round((bestLoggedMiles - expectedMiles) * 10) / 10
      : null;
  const variancePercent =
    varianceMiles != null && expectedMiles != null && expectedMiles > 0
      ? Math.round((varianceMiles / expectedMiles) * 1000) / 10
      : null;

  return JSON.stringify({
    ticketId: Math.floor(ticketId),
    logged,
    expectedRoute,
    comparison: {
      bestLoggedMiles,
      expectedRoadMiles: expectedMiles,
      varianceMiles,
      variancePercent,
      note:
        expectedRoute == null
          ? "Expected road miles require origin=shop or currentLatitude/currentLongitude."
          : "Compare odometer miles first, otherwise GPS trail miles, against Mapbox road miles.",
    },
  });
}

async function queryHotlistJobs(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "query_hotlist_jobs");
  if (blocked) return blocked;
  const limit = clampLimit(args.limit);
  const filters = [eq(hotlistJobsTable.status, "open"), isNull(hotlistJobsTable.deletedAt)];
  if (session.role === "partner" && session.partnerId) {
    filters.push(eq(hotlistJobsTable.partnerId, session.partnerId));
  } else if (session.role === "vendor" && session.vendorId) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM partner_vendor_relationships pvr
        WHERE pvr.partner_id = ${hotlistJobsTable.partnerId}
          AND pvr.vendor_id = ${session.vendorId}
          AND pvr.status = 'approved'
      )`,
    );
  }
  const rows = await db
    .select({
      id: hotlistJobsTable.id,
      title: hotlistJobsTable.title,
      partnerId: hotlistJobsTable.partnerId,
      status: hotlistJobsTable.status,
      deadline: hotlistJobsTable.deadline,
      locationAddress: hotlistJobsTable.locationAddress,
    })
    .from(hotlistJobsTable)
    .where(and(...filters))
    .orderBy(desc(hotlistJobsTable.createdAt))
    .limit(limit);
  return JSON.stringify({ rows, limit });
}

async function queryHotlistBids(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "query_hotlist_bids");
  if (blocked) return blocked;
  if (session.role !== "vendor" || !session.vendorId) {
    return err("Vendor account required.");
  }
  const limit = clampLimit(args.limit);
  const rows = await db
    .select({
      id: hotlistBidsTable.id,
      jobId: hotlistBidsTable.jobId,
      amountUsd: hotlistBidsTable.amountUsd,
      status: hotlistBidsTable.status,
      createdAt: hotlistBidsTable.createdAt,
      jobTitle: hotlistJobsTable.title,
    })
    .from(hotlistBidsTable)
    .innerJoin(hotlistJobsTable, eq(hotlistBidsTable.jobId, hotlistJobsTable.id))
    .where(eq(hotlistBidsTable.vendorId, session.vendorId))
    .orderBy(desc(hotlistBidsTable.createdAt))
    .limit(limit);
  return JSON.stringify({ rows, limit });
}

async function queryVendorCatalog(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "query_vendor_catalog");
  if (blocked) return blocked;
  const vendorId =
    session.role === "vendor" ? session.vendorId : args.vendorId ? Number(args.vendorId) : null;
  if (!vendorId) return err("Vendor scope required.");
  const partnerIds = await vendorCatalogPartnerIds(session, vendorId);
  if (partnerIds === null) return err("Authorized vendor catalog access required.");
  const limit = Math.min(MAX_LIMIT, clampLimit(args.limit));
  const rows = partnerIds.length ? await db
    .select({
      id: vendorWorkTypesTable.id,
      workTypeId: vendorWorkTypesTable.workTypeId,
      workTypeName: workTypesTable.name,
      partnerId: workTypesTable.partnerId,
      unitPrice: vendorWorkTypesTable.unitPrice,
      unit: vendorWorkTypesTable.unit,
    })
    .from(vendorWorkTypesTable)
    .innerJoin(workTypesTable, eq(vendorWorkTypesTable.workTypeId, workTypesTable.id))
    .where(and(eq(vendorWorkTypesTable.vendorId, vendorId), inArray(workTypesTable.partnerId, partnerIds)))
    .limit(limit) : [];
  return JSON.stringify({ rows, limit, vendorId });
}

async function queryPartnerApprovals(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "query_partner_approvals");
  if (blocked) return blocked;
  const limit = clampLimit(args.limit);
  const filters = [];
  if (session.role === "partner" && session.partnerId) {
    filters.push(eq(partnerVendorWorkTypeApprovalsTable.partnerId, session.partnerId));
  } else if (session.role === "vendor" && session.vendorId) {
    filters.push(eq(partnerVendorWorkTypeApprovalsTable.vendorId, session.vendorId));
  } else if (session.role !== "admin") {
    return err("Partner or vendor scope required.");
  }
  const rows = await db
    .select({
      id: partnerVendorWorkTypeApprovalsTable.id,
      partnerId: partnerVendorWorkTypeApprovalsTable.partnerId,
      vendorId: partnerVendorWorkTypeApprovalsTable.vendorId,
      workTypeId: partnerVendorWorkTypeApprovalsTable.workTypeId,
      approvedAt: partnerVendorWorkTypeApprovalsTable.approvedAt,
      approvedUnitPrice: partnerVendorWorkTypeApprovalsTable.approvedUnitPrice,
      partnerName: partnersTable.name,
      vendorName: vendorsTable.name,
      workTypeName: workTypesTable.name,
    })
    .from(partnerVendorWorkTypeApprovalsTable)
    .innerJoin(partnersTable, eq(partnerVendorWorkTypeApprovalsTable.partnerId, partnersTable.id))
    .innerJoin(vendorsTable, eq(partnerVendorWorkTypeApprovalsTable.vendorId, vendorsTable.id))
    .innerJoin(workTypesTable, eq(partnerVendorWorkTypeApprovalsTable.workTypeId, workTypesTable.id))
    .where(filters.length ? and(...filters) : undefined)
    .limit(limit);
  return JSON.stringify({ rows, limit });
}

async function queryCertifications(args: Record<string, unknown>, session: SessionPayload) {
  const limit = clampLimit(args.limit);
  const expiringDays = clampSinceDays(args.expiringWithinDays ?? 30);
  const today = new Date();
  const future = new Date(today);
  future.setUTCDate(future.getUTCDate() + expiringDays);
  const todayStr = today.toISOString().slice(0, 10);
  const futureStr = future.toISOString().slice(0, 10);
  const filters = [
    gte(employeeCertificationsTable.expirationDate, todayStr),
    sql`${employeeCertificationsTable.expirationDate} <= ${futureStr}`,
    isNull(employeeCertificationsTable.deletedAt),
  ];
  if (session.role === "vendor" && session.vendorId) {
    filters.push(eq(vendorPeopleTable.vendorId, session.vendorId));
  } else if (session.role === "field_employee" && session.vendorPeopleId) {
    filters.push(eq(employeeCertificationsTable.employeeId, session.vendorPeopleId));
  } else if (session.role !== "admin" && session.role !== "partner") {
    return err("Not available for this role.");
  }
  const rows = await db
    .select({
      id: employeeCertificationsTable.id,
      certName: employeeCertificationsTable.name,
      expirationDate: employeeCertificationsTable.expirationDate,
      employeeName: sql<string>`${vendorPeopleTable.firstName} || ' ' || ${vendorPeopleTable.lastName}`,
    })
    .from(employeeCertificationsTable)
    .innerJoin(vendorPeopleTable, eq(employeeCertificationsTable.employeeId, vendorPeopleTable.id))
    .where(and(...filters))
    .orderBy(employeeCertificationsTable.expirationDate)
    .limit(limit);
  return JSON.stringify({ rows, limit });
}

async function lookupOrgContacts(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "lookup_org_contacts");
  if (blocked) return blocked;
  const roleFilter = args.role ? String(args.role) : "HSE / Safety Officer";
  const limit = clampLimit(args.limit);
  if (session.role === "partner" && session.partnerId) {
    const rows = await db
      .select({
        name: partnerContactsTable.name,
        email: partnerContactsTable.email,
        roles: partnerContactsTable.roles,
      })
      .from(partnerContactsTable)
      .where(
        and(
          eq(partnerContactsTable.partnerId, session.partnerId),
          isNull(partnerContactsTable.deletedAt),
          sql`${roleFilter} = ANY(${partnerContactsTable.roles})`,
        ),
      )
      .limit(limit);
    return JSON.stringify({ org: "partner", rows, limit });
  }
  if (session.role === "vendor" && session.vendorId) {
    const rows = await db
      .select({
        name: sql<string>`${vendorPeopleTable.firstName} || ' ' || ${vendorPeopleTable.lastName}`,
        email: vendorPeopleTable.email,
        roles: vendorPeopleTable.roles,
      })
      .from(vendorPeopleTable)
      .where(
        and(
          eq(vendorPeopleTable.vendorId, session.vendorId),
          eq(vendorPeopleTable.isActive, true),
          sql`${roleFilter} = ANY(${vendorPeopleTable.roles})`,
        ),
      )
      .limit(limit);
    return JSON.stringify({ org: "vendor", rows, limit });
  }
  return err("Partner or vendor scope required.");
}

async function queryFlaggedTickets(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "query_flagged_tickets");
  if (blocked) return blocked;
  const limit = clampLimit(args.limit);
  const filters = [isNull(ticketFlagsTable.clearedAt)];
  if (session.role === "partner" && session.partnerId) {
    filters.push(
      sql`${ticketsTable.siteLocationId} IN (SELECT id FROM site_locations WHERE partner_id = ${session.partnerId})`,
    );
  } else if (session.role === "vendor" && session.vendorId) {
    filters.push(eq(ticketsTable.vendorId, session.vendorId));
  }
  const rows = await db
    .select({
      flagId: ticketFlagsTable.id,
      ticketId: ticketFlagsTable.ticketId,
      reason: ticketFlagsTable.reason,
      createdAt: ticketFlagsTable.createdAt,
    })
    .from(ticketFlagsTable)
    .innerJoin(ticketsTable, eq(ticketFlagsTable.ticketId, ticketsTable.id))
    .where(and(...filters))
    .orderBy(desc(ticketFlagsTable.createdAt))
    .limit(limit);
  return JSON.stringify({ rows, limit });
}

async function lookupTicketPaymentStatus(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "lookup_ticket_payment_status");
  if (blocked) return blocked;
  const ticketId = Number(args.ticketId);
  if (!Number.isFinite(ticketId)) return err("ticketId is required.");
  const [row] = await db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      paymentMethod: ticketsTable.paymentMethod,
      paymentReference: ticketsTable.paymentReference,
      paymentDispersedAt: ticketsTable.paymentDispersedAt,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId))
    .limit(1);
  if (!row) return err(`Ticket ${ticketId} not found.`);
  return JSON.stringify(row);
}

async function lookupAccountingConnection(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "lookup_accounting_connection");
  if (blocked) return blocked;
  if (session.role !== "vendor" || !session.vendorId) {
    return err("Vendor account required.");
  }
  const rows = await db
    .select({
      provider: accountingConnectionsTable.provider,
      status: accountingConnectionsTable.status,
      displayName: accountingConnectionsTable.displayName,
      updatedAt: accountingConnectionsTable.updatedAt,
    })
    .from(accountingConnectionsTable)
    .where(eq(accountingConnectionsTable.vendorId, session.vendorId));
  return JSON.stringify({ connections: rows });
}

async function queryActiveVisitors(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "query_active_visitors");
  if (blocked) return blocked;
  const limit = clampLimit(args.limit);
  const filters = [isNull(siteVisitsTable.checkOutTime)];
  if (args.siteId) filters.push(eq(siteVisitsTable.siteLocationId, Number(args.siteId)));
  if (session.role === "partner" && session.partnerId) {
    filters.push(sql`${siteVisitsTable.siteLocationId} IN (SELECT id FROM site_locations WHERE partner_id = ${session.partnerId})`);
  } else if (session.role === "vendor" && session.vendorId) {
    filters.push(eq(siteVisitsTable.hostVendorId, session.vendorId));
  } else if (session.role !== "admin") {
    return err("No organization scope on this session.");
  }
  const rows = await db
    .select({
      id: siteVisitsTable.id,
      firstName: siteVisitsTable.firstName,
      lastName: siteVisitsTable.lastName,
      company: siteVisitsTable.company,
      vehiclePlate: siteVisitsTable.vehiclePlate,
      plateState: siteVisitsTable.plateState,
      platePhotoUrl: siteVisitsTable.platePhotoUrl,
      vehiclePhotoUrl: siteVisitsTable.vehiclePhotoUrl,
      purpose: siteVisitsTable.purpose,
      siteLocationId: siteVisitsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      checkInTime: siteVisitsTable.checkInTime,
    })
    .from(siteVisitsTable)
    .leftJoin(siteLocationsTable, eq(siteLocationsTable.id, siteVisitsTable.siteLocationId))
    .where(and(...filters))
    .orderBy(desc(siteVisitsTable.checkInTime))
    .limit(limit);
  return JSON.stringify({
    rows: rows.map((row) => ({ ...row, plateState: normalizePlateState(row.plateState) })),
    limit,
  });
}

export async function runOpsDataTool(
  name: OpsDataToolName,
  args: Record<string, unknown>,
  session: SessionPayload,
): Promise<string> {
  switch (name) {
    case "query_gate_report":
      try { return JSON.stringify(await getGateReport(session, { ...args, limit: 50 })); }
      catch (error) { if (error instanceof GateReportError) return err(error.message); throw error; }
    case "query_safety_events":
      return querySafetyEvents(args, session);
    case "lookup_safety_metrics":
      return lookupSafetyMetrics(args, session);
    case "lookup_site_operational_status":
      return lookupSiteOperationalStatus(args, session);
    case "query_site_locations":
      return querySiteLocations(args, session);
    case "lookup_site_detail":
      return lookupSiteDetail(args, session);
    case "query_notifications":
      return queryNotifications(args, session);
    case "query_attention_briefing":
      return queryAttentionBriefing(args, session);
    case "query_live_crew":
      return queryLiveCrew(args, session);
    case "lookup_crew_member_status":
      return lookupCrewMemberStatus(args, session);
    case "query_crew_eta":
      return queryCrewEta(args, session);
    case "query_crew_route_summary":
      return queryCrewRouteSummary(args, session);
    case "lookup_map_origin":
      return lookupMapOrigin(args, session);
    case "query_ticket_logged_miles":
      return queryTicketLoggedMiles(args, session);
    case "query_ticket_route_eta":
      return queryTicketRouteEta(args, session);
    case "query_ticket_mileage_audit":
      return queryTicketMileageAudit(args, session);
    case "estimate_driving_route":
      return estimateDrivingRoute(args, session);
    case "query_hotlist_jobs":
      return queryHotlistJobs(args, session);
    case "query_hotlist_bids":
      return queryHotlistBids(args, session);
    case "query_vendor_catalog":
      return queryVendorCatalog(args, session);
    case "query_partner_approvals":
      return queryPartnerApprovals(args, session);
    case "query_certifications":
      return queryCertifications(args, session);
    case "lookup_org_contacts":
      return lookupOrgContacts(args, session);
    case "query_flagged_tickets":
      return queryFlaggedTickets(args, session);
    case "lookup_ticket_payment_status":
      return lookupTicketPaymentStatus(args, session);
    case "lookup_accounting_connection":
      return lookupAccountingConnection(args, session);
    case "query_active_visitors":
      return queryActiveVisitors(args, session);
  }
}
