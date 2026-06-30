// AskV read-only tools — safety, sites, ops, hotlist, catalog, notifications.

import { and, asc, desc, eq, gte, ilike, inArray, isNull, sql } from "drizzle-orm";
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

export const OPS_DATA_TOOL_NAMES = [
  "query_safety_events",
  "lookup_safety_metrics",
  "lookup_site_operational_status",
  "query_site_locations",
  "lookup_site_detail",
  "query_notifications",
  "query_live_crew",
  "lookup_crew_member_status",
  "query_crew_eta",
  "query_crew_route_summary",
  "query_hotlist_jobs",
  "query_hotlist_bids",
  "query_vendor_catalog",
  "query_partner_approvals",
  "query_certifications",
  "lookup_org_contacts",
  "query_flagged_tickets",
  "lookup_ticket_payment_status",
  "lookup_accounting_connection",
  "query_active_visitors",
] as const;

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
  if (session.role === "partner" && session.partnerId !== status.partnerId) {
    return err("Site not visible to your account.");
  }
  return JSON.stringify(status);
}

async function querySiteLocations(args: Record<string, unknown>, session: SessionPayload) {
  const blocked = blockFieldEmployee(session, "query_site_locations");
  if (blocked) return blocked;
  const limit = clampLimit(args.limit);
  const filters = [eq(siteLocationsTable.hidden, false)];
  if (session.role === "partner" && session.partnerId) {
    filters.push(eq(siteLocationsTable.partnerId, session.partnerId));
  } else if (session.role === "vendor" && session.vendorId) {
    filters.push(
      sql`${siteLocationsTable.id} IN (
        SELECT site_location_id FROM site_work_assignments
        WHERE vendor_id = ${session.vendorId}
      )`,
    );
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
  if (session.role === "partner" && session.partnerId !== site.partnerId) {
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
  const distanceToSiteMiles = milesBetween(lastGps, {
    latitude: ticket.siteLatitude,
    longitude: ticket.siteLongitude,
  });
  const speedMph = lastGps.speedMps && lastGps.speedMps > 0
    ? lastGps.speedMps * 2.2369362921
    : null;
  const fallbackMph = 45;
  const etaMinutes = Math.round((distanceToSiteMiles / (speedMph && speedMph >= 5 ? speedMph : fallbackMph)) * 60);
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
    estimateBasis: speedMph && speedMph >= 5 ? "current_gps_speed" : "fallback_45_mph",
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
  let miles = 0;
  for (let i = 1; i < points.length; i += 1) {
    miles += milesBetween(points[i - 1], points[i]);
  }
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
    routeMilesApprox: Math.round(miles * 10) / 10,
    durationMinutes,
    activeCheckIn: activeCheckIn ?? null,
    locationSource: "ticket_gps_trail",
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
  const limit = Math.min(MAX_LIMIT, clampLimit(args.limit));
  const rows = await db
    .select({
      id: vendorWorkTypesTable.id,
      workTypeId: vendorWorkTypesTable.workTypeId,
      workTypeName: workTypesTable.name,
      unitPrice: vendorWorkTypesTable.unitPrice,
      unit: vendorWorkTypesTable.unit,
    })
    .from(vendorWorkTypesTable)
    .innerJoin(workTypesTable, eq(vendorWorkTypesTable.workTypeId, workTypesTable.id))
    .where(eq(vendorWorkTypesTable.vendorId, vendorId))
    .limit(limit);
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
    filters.push(eq(siteVisitsTable.hostPartnerId, session.partnerId));
  }
  const rows = await db
    .select({
      id: siteVisitsTable.id,
      firstName: siteVisitsTable.firstName,
      lastName: siteVisitsTable.lastName,
      company: siteVisitsTable.company,
      siteLocationId: siteVisitsTable.siteLocationId,
      checkInTime: siteVisitsTable.checkInTime,
    })
    .from(siteVisitsTable)
    .where(and(...filters))
    .orderBy(desc(siteVisitsTable.checkInTime))
    .limit(limit);
  return JSON.stringify({ rows, limit });
}

export async function runOpsDataTool(
  name: OpsDataToolName,
  args: Record<string, unknown>,
  session: SessionPayload,
): Promise<string> {
  switch (name) {
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
    case "query_live_crew":
      return queryLiveCrew(args, session);
    case "lookup_crew_member_status":
      return lookupCrewMemberStatus(args, session);
    case "query_crew_eta":
      return queryCrewEta(args, session);
    case "query_crew_route_summary":
      return queryCrewRouteSummary(args, session);
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
