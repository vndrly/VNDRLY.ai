import { Router, type IRouter } from "express";
import { and, eq, gte, isNull, inArray, sql, lte, asc, ne, or } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  ticketsTable,
  ticketCrewTable,
  ticketScheduledNotificationsTable,
  vendorPeopleTable,
  siteLocationsTable,
  partnersTable,
  workTypesTable,
  vendorsTable,
  usersTable,
  userOrgMembershipsTable,
  employeeCertificationsTable,
  gpsLogsTable,
  scheduleCertOverrideAuditLogTable,
} from "@workspace/db";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import {
  CREW_INVALID_FOR_VENDOR,
  FOREMAN_NOT_IN_CREW,
} from "@workspace/crew-validation-codes";
import { logger } from "../lib/logger";
import { SESSION_SECRET } from "../lib/session";
import { notifyUsers, fanOutPushToUser } from "./notifications";
import { notifyRemovedCrewMember } from "./crew";

// ── Geo helpers ─────────────────────────────────────────────────────────
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const AVG_ROAD_SPEED_KMH = 50;
function etaMinutesFromMeters(meters: number): number {
  const km = meters / 1000;
  return Math.round((km / AVG_ROAD_SPEED_KMH) * 60);
}

const COOKIE_NAME = "vndrly_session";
type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null; vendorRole?: string | null };

function getSession(req: any): Session | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie) return null;
  const lastDot = cookie.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = cookie.slice(0, lastDot);
  const sig = cookie.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch { return null; }
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (!obj || typeof obj.exp !== "number" || obj.exp < now) return null;
    return obj;
  } catch { return null; }
}

const VALID_KINDS = new Set(["3d", "2d", "1d", "12h", "4h", "1h", "start"]);
const KIND_OFFSET_MS: Record<string, number> = {
  "3d": 3 * 24 * 60 * 60 * 1000,
  "2d": 2 * 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "start": 0,
};

// Task #650: how far past `scheduledStartAt` we look ahead for certs that
// will expire "soon". A cert that's still valid today but expires inside
// this window is surfaced as an informational (amber) heads-up so leads
// can swap people or chase renewals before dispatch. Keep the env knob
// parsing tolerant — any non-positive / non-finite override falls back to
// the 30-day default so a fat-fingered config can't disable the warnings.
const CERT_EXPIRING_SOON_DAYS_DEFAULT = 30;
function certExpiringSoonWindowDays(): number {
  const raw = process.env.CERT_EXPIRING_SOON_DAYS;
  if (raw == null || raw === "") return CERT_EXPIRING_SOON_DAYS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return CERT_EXPIRING_SOON_DAYS_DEFAULT;
  return Math.floor(n);
}

const router: IRouter = Router();

async function loadTicketForAuth(ticketId: number) {
  const [t] = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      status: ticketsTable.status,
      siteLocationId: ticketsTable.siteLocationId,
      partnerId: siteLocationsTable.partnerId,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, ticketId));
  return t || null;
}

// Platform admin OR vendor admin OR assigned / acting foreman on this ticket.
async function resolveSchedulerAuth(
  session: Session,
  ticketId: number,
  ticketVendorId: number,
): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.role === "vendor" && session.vendorId === ticketVendorId) {
    const [m] = await db
      .select({ role: userOrgMembershipsTable.role })
      .from(userOrgMembershipsTable)
      .where(and(
        eq(userOrgMembershipsTable.userId, session.userId),
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, ticketVendorId),
      ));
    if (m && m.role === "admin") return true;
  }
  if (session.role === "field_employee") {
    // Vendor foremen may schedule any open ticket on their vendor (mobile
    // vendorWide picker). Assigned / acting foremen keep access on their ticket.
    if (
      session.vendorId === ticketVendorId &&
      (session.vendorRole === "foreman" || session.vendorRole === "both")
    ) {
      return true;
    }
    const [t] = await db
      .select({
        foremanUserId: ticketsTable.foremanUserId,
        actingForemanUserId: ticketsTable.actingForemanUserId,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId));
    if (
      t &&
      (t.foremanUserId === session.userId || t.actingForemanUserId === session.userId)
    ) {
      return true;
    }
  }
  return false;
}

async function ensureSchedulerAuth(req: any, res: any, ticketId: number): Promise<{ session: Session; vendorId: number } | null> {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: "not_authenticated", message: "Not authenticated", code: "auth.not_authenticated" }); return null; }
  const ticket = await loadTicketForAuth(ticketId);
  if (!ticket) { res.status(404).json({ error: "ticket_not_found", message: "Ticket not found", code: "ticket.not_found" }); return null; }
  if (await resolveSchedulerAuth(session, ticketId, ticket.vendorId)) {
    return { session, vendorId: ticket.vendorId };
  }
  res.status(403).json({ error: "forbidden_not_scheduler", message: "Not allowed", code: "ticket.no_access" });
  return null;
}

/** Scheduler auth, or any active crew member on a scheduled ticket (for .ics). */
async function ensureScheduleOrCrewAuth(
  req: any,
  res: any,
  ticketId: number,
): Promise<{ session: Session; vendorId: number } | null> {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      error: "not_authenticated",
      message: "Not authenticated",
      code: "auth.not_authenticated",
    });
    return null;
  }

  const ticket = await loadTicketForAuth(ticketId);
  if (!ticket) {
    res.status(404).json({
      error: "ticket_not_found",
      message: "Ticket not found",
      code: "ticket.not_found",
    });
    return null;
  }

  if (await resolveSchedulerAuth(session, ticketId, ticket.vendorId)) {
    return { session, vendorId: ticket.vendorId };
  }

  const [sched] = await db
    .select({ scheduledStartAt: ticketsTable.scheduledStartAt })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!sched?.scheduledStartAt) {
    res.status(409).json({
      error: "not_scheduled",
      message: "Ticket is not scheduled",
      code: "schedule.not_scheduled",
    });
    return null;
  }

  const [me] = await db
    .select({ id: vendorPeopleTable.id })
    .from(vendorPeopleTable)
    .where(and(
      eq(vendorPeopleTable.userId, session.userId),
      eq(vendorPeopleTable.vendorId, ticket.vendorId),
      isNull(vendorPeopleTable.deletedAt),
    ));
  if (me) {
    const [onCrew] = await db
      .select({ ticketId: ticketCrewTable.ticketId })
      .from(ticketCrewTable)
      .where(and(
        eq(ticketCrewTable.ticketId, ticketId),
        eq(ticketCrewTable.employeeId, me.id),
        isNull(ticketCrewTable.removedAt),
      ));
    if (onCrew) return { session, vendorId: ticket.vendorId };
  }

  res.status(403).json({
    error: "forbidden_not_scheduler",
    message: "Not allowed",
    code: "ticket.no_access",
  });
  return null;
}

// ── POST /api/tickets/:id/schedule ─────────────────────────────────────
export async function handleScheduleTicketRequest(req: any, res: any): Promise<void> {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "invalid_ticket_id", message: "Invalid id", code: "validation.invalid_id" }); return; }
  const auth = await ensureSchedulerAuth(req, res, ticketId);
  if (!auth) return;

  const body = req.body ?? {};
  const scheduledStartAt = body.scheduledStartAt ? new Date(body.scheduledStartAt) : null;
  if (!scheduledStartAt || Number.isNaN(scheduledStartAt.getTime())) {
    res.status(400).json({
      error: "scheduled_start_at_required",
      message: "scheduledStartAt required",
      code: "schedule.start_required",
    });
    return;
  }
  const scheduledDurationMinutes = body.scheduledDurationMinutes != null
    ? Number(body.scheduledDurationMinutes)
    : null;
  if (scheduledDurationMinutes != null && (!Number.isFinite(scheduledDurationMinutes) || scheduledDurationMinutes < 0)) {
    res.status(400).json({
      error: "invalid_scheduled_duration_minutes",
      message: "Invalid scheduledDurationMinutes",
      code: "schedule.invalid_duration",
    });
    return;
  }
  const foremanUserId = body.foremanUserId != null ? Number(body.foremanUserId) : null;
  const actingForemanUserId = body.actingForemanUserId != null
    ? Number(body.actingForemanUserId)
    : null;
  const crewEmployeeIds: number[] = Array.isArray(body.crewEmployeeIds)
    ? body.crewEmployeeIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
    : [];
  const warningKinds: string[] = Array.isArray(body.warningKinds)
    ? Array.from(new Set(
        body.warningKinds.filter((k: unknown): k is string => typeof k === "string" && VALID_KINDS.has(k))
      ))
    : [];

  // Validate crew: every employee must belong to this ticket's vendor and be active.
  let crewRows: { id: number; userId: number | null; firstName: string; lastName: string }[] = [];
  if (crewEmployeeIds.length > 0) {
    crewRows = await db
      .select({
        id: vendorPeopleTable.id,
        userId: vendorPeopleTable.userId,
        firstName: vendorPeopleTable.firstName,
        lastName: vendorPeopleTable.lastName,
        vendorId: vendorPeopleTable.vendorId,
      })
      .from(vendorPeopleTable)
      .where(and(
        inArray(vendorPeopleTable.id, crewEmployeeIds),
        isNull(vendorPeopleTable.deletedAt),
      ))
      .then(rows => rows.filter(r => r.vendorId === auth.vendorId));
    if (crewRows.length !== crewEmployeeIds.length) {
      res.status(400).json({
        error: CREW_INVALID_FOR_VENDOR,
        message: "One or more crew members are invalid for this vendor",
        code: "schedule.invalid_crew",
      });
      return;
    }
  }

  // Validate foreman if provided: must be one of the crew members and have a userId.
  if (foremanUserId != null) {
    const okForeman = crewRows.some(r => r.userId === foremanUserId);
    if (!okForeman) {
      res.status(400).json({
        error: FOREMAN_NOT_IN_CREW,
        message: "Foreman must be one of the assigned crew members with a login",
        code: "schedule.invalid_foreman",
      });
      return;
    }
  }

  // Acting foreman: same crew + login rule; may differ from primary foreman.
  if (actingForemanUserId != null) {
    const okActing = crewRows.some(r => r.userId === actingForemanUserId);
    if (!okActing) {
      res.status(400).json({
        error: FOREMAN_NOT_IN_CREW,
        message: "Acting foreman must be one of the assigned crew members with a login",
        code: "schedule.invalid_acting_foreman",
      });
      return;
    }
  }

  // Ticket details for push payload.
  // fields (scheduledStartAt + scheduledDurationMinutes) so we can diff
  // them against the incoming values below to decide whether an
  // already-on-roster crew member should get a `schedule_changed`
  // notification (Task #649) instead of the generic `crew_added`.
  const [ticket] = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      siteLocationId: ticketsTable.siteLocationId,
      workTypeId: ticketsTable.workTypeId,
      previousScheduledStartAt: ticketsTable.scheduledStartAt,
      previousScheduledDurationMinutes: ticketsTable.scheduledDurationMinutes,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!ticket) { res.status(404).json({ error: "ticket_not_found", message: "Ticket not found", code: "ticket.not_found" }); return; }

  const [site] = await db
    .select({ name: siteLocationsTable.name, address: siteLocationsTable.address, partnerId: siteLocationsTable.partnerId })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, ticket.siteLocationId));
  const [workType] = await db
    .select({
      name: workTypesTable.name,
      requiredCertifications: workTypesTable.requiredCertifications,
      blockingCertifications: workTypesTable.blockingCertifications,
    })
    .from(workTypesTable)
    .where(eq(workTypesTable.id, ticket.workTypeId));
  const [partner] = site ? await db
    .select({ name: partnersTable.name })
    .from(partnersTable)
    .where(eq(partnersTable.id, site.partnerId)) : [];

  // ── Conflict detection ──────────────────────────────────────────────
  // For each selected crew member, find any other ticket they're crewed on
  // whose [start, start+duration] window overlaps this one. If conflicts
  // exist and the caller didn't pass force=true, return them so the UI can
  // confirm before re-posting.
  const force = body.force === true;
  let conflicts: Array<{
    employeeId: number; employeeName: string; otherTicketId: number;
    otherWorkType: string | null; otherSiteName: string | null;
    otherStartAt: string; otherDurationMinutes: number | null;
  }> = [];
  if (!force && crewEmployeeIds.length > 0) {
    const durMs = (scheduledDurationMinutes ?? 60) * 60 * 1000;
    const startA = scheduledStartAt;
    const endA = new Date(startA.getTime() + durMs);
    const overlapping = await db
      .select({
        employeeId: ticketCrewTable.employeeId,
        employeeFirst: vendorPeopleTable.firstName,
        employeeLast: vendorPeopleTable.lastName,
        otherTicketId: ticketsTable.id,
        otherStartAt: ticketsTable.scheduledStartAt,
        otherDurationMinutes: ticketsTable.scheduledDurationMinutes,
        otherWorkType: workTypesTable.name,
        otherSiteName: siteLocationsTable.name,
      })
      .from(ticketCrewTable)
      .innerJoin(ticketsTable, eq(ticketCrewTable.ticketId, ticketsTable.id))
      .leftJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
      .leftJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
      .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
      .where(and(
        inArray(ticketCrewTable.employeeId, crewEmployeeIds),
        isNull(ticketCrewTable.removedAt),
        ne(ticketCrewTable.ticketId, ticketId),
        sql`${ticketsTable.scheduledStartAt} IS NOT NULL`,
        // Overlap test: otherStart < endA AND otherStart + COALESCE(otherDur,60)*60000 > startA
        sql`${ticketsTable.scheduledStartAt} < ${endA}`,
        sql`${ticketsTable.scheduledStartAt} + (COALESCE(${ticketsTable.scheduledDurationMinutes}, 60) * INTERVAL '1 minute') > ${startA}`,
      ));
    conflicts = overlapping.map(r => ({
      employeeId: r.employeeId,
      employeeName: `${r.employeeFirst ?? ""} ${r.employeeLast ?? ""}`.trim() || `Employee #${r.employeeId}`,
      otherTicketId: r.otherTicketId,
      otherWorkType: r.otherWorkType,
      otherSiteName: r.otherSiteName,
      otherStartAt: (r.otherStartAt as Date).toISOString(),
      otherDurationMinutes: r.otherDurationMinutes,
    }));
    if (conflicts.length > 0) {
      res.status(200).json({ requiresConfirm: true, conflicts });
      return;
    }
  }

  // ── Certification handling ─────────────────────────────────────────
  // Three parallel concerns share a single pass through
  // `employee_certifications`:
  //   • `certWarnings` (red, warn-only): required cert is missing OR
  //     already expired today. Existing semantics preserved for the
  //     ticket-schedule-cert-warnings regression test.
  //   • `certExpiringSoon` (amber, Task #650, warn-only): required cert
  //     is currently valid (so NOT in `missing`) but its expirationDate
  //     falls on or before `scheduledStartAt + window`. Catches certs
  //     that lapse just before or just after dispatch.
  //   • `blockingMissing` (hard block, Task #651): a `blocking_certs`
  //     entry on the work type is missing or expired for any crew
  //     member. Returns 400 with `code: "schedule.certifications_blocked"`.
  //     Platform admins (role "admin") can re-POST with
  //     `overrideBlockingCerts: true` to push through (audit-logged
  //     below). Non-admins cannot override even with the flag set —
  //     keeping the bypass path narrow.
  //
  // We compute haveByEmp once and reuse it for all checks so we only
  // hit `employee_certifications` once per scheduling attempt.
  const requiredCerts: string[] = (workType?.requiredCertifications as string[] | null) ?? [];
  const blockingCerts: string[] = (workType?.blockingCertifications as string[] | null) ?? [];
  const overrideBlockingCerts = body.overrideBlockingCerts === true;
  let certWarnings: Array<{ employeeId: number; employeeName: string; missing: string[] }> = [];
  let certExpiringSoon: Array<{
    employeeId: number;
    employeeName: string;
    expiring: Array<{ name: string; expirationDate: string; daysUntilExpiration: number }>;
  }> = [];
  let blockingMissing: Array<{ employeeId: number; employeeName: string; missing: string[] }> = [];
  if ((requiredCerts.length > 0 || blockingCerts.length > 0) && crewEmployeeIds.length > 0) {
    const certRows = await db
      .select({
        employeeId: employeeCertificationsTable.employeeId,
        name: employeeCertificationsTable.name,
        expirationDate: employeeCertificationsTable.expirationDate,
      })
      .from(employeeCertificationsTable)
      .where(inArray(employeeCertificationsTable.employeeId, crewEmployeeIds));
    const today = new Date();
    const windowDays = certExpiringSoonWindowDays();
    const expiringWindowEnd = new Date(
      scheduledStartAt.getTime() + windowDays * 24 * 60 * 60 * 1000,
    );
    const requiredSet = new Set(requiredCerts);
    const haveByEmp = new Map<number, Set<string>>();
    // Map of employeeId → required cert name → soonest expiration date
    // among the still-valid copies. We pick the soonest (most urgent)
    // when an employee has duplicate copies of the same cert so the
    // amber warning reflects the worst-case lapse, not a stale earlier
    // copy that was already renewed.
    const expByEmp = new Map<number, Map<string, Date>>();
    for (const c of certRows) {
      if (c.expirationDate && new Date(c.expirationDate) < today) continue;
      const s = haveByEmp.get(c.employeeId) ?? new Set<string>();
      s.add(c.name);
      haveByEmp.set(c.employeeId, s);
      // Track expiration only for required certs that have a date set;
      // an open-ended cert (null expirationDate) is never "expiring".
      if (c.expirationDate && requiredSet.has(c.name)) {
        const exp = new Date(c.expirationDate);
        const perEmp = expByEmp.get(c.employeeId) ?? new Map<string, Date>();
        const prior = perEmp.get(c.name);
        if (!prior || exp < prior) perEmp.set(c.name, exp);
        expByEmp.set(c.employeeId, perEmp);
      }
    }
    for (const cr of crewRows) {
      const have = haveByEmp.get(cr.id) ?? new Set<string>();
      const employeeName =
        `${cr.firstName ?? ""} ${cr.lastName ?? ""}`.trim() || `Employee #${cr.id}`;
      // Warn-only required certs (red toast in the modal).
      if (requiredCerts.length > 0) {
        const missing = requiredCerts.filter(req => !have.has(req));
        if (missing.length > 0) {
          certWarnings.push({ employeeId: cr.id, employeeName, missing });
        }
        // Task #650: amber expiring-soon list. Computed only for
        // required certs the employee actually has — anything in
        // `missing` is already covered by certWarnings, so the two
        // arrays stay disjoint per (employee, cert) and we never
        // double-warn.
        const perEmp = expByEmp.get(cr.id);
        if (perEmp) {
          const expiring: Array<{ name: string; expirationDate: string; daysUntilExpiration: number }> = [];
          for (const req of requiredCerts) {
            if (!have.has(req)) continue; // covered by `missing`
            const exp = perEmp.get(req);
            if (!exp) continue; // no date → never "expiring"
            if (exp <= expiringWindowEnd) {
              const daysUntilExpiration = Math.ceil(
                (exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
              );
              expiring.push({
                name: req,
                expirationDate: exp.toISOString(),
                daysUntilExpiration,
              });
            }
          }
          if (expiring.length > 0) {
            certExpiringSoon.push({ employeeId: cr.id, employeeName, expiring });
          }
        }
      }
      // Task #651: hard-blocking certs. Computed independently from
      // required so a work type can declare a cert as blocking-only
      // (without also being in `requiredCertifications`) and still
      // hit the 400 path below.
      if (blockingCerts.length > 0) {
        const missing = blockingCerts.filter(req => !have.has(req));
        if (missing.length > 0) {
          blockingMissing.push({ employeeId: cr.id, employeeName, missing });
        }
      }
    }
  }

  if (blockingMissing.length > 0) {
    // Only platform admins (role "admin") may override. We surface
    // `canOverride` in the response so the modal can show the override
    // affordance, but the server still enforces the role on the
    // re-POST below — a non-admin sending `overrideBlockingCerts: true`
    // gets the same 400 as not sending the flag at all.
    const isPlatformAdmin = auth.session.role === "admin";
    if (!overrideBlockingCerts || !isPlatformAdmin) {
      res.status(400).json({
        error: "certifications_blocked",
        message:
          "One or more crew members are missing certifications required to schedule this work type.",
        code: "schedule.certifications_blocked",
        canOverride: isPlatformAdmin,
        blockingCertifications: blockingCerts,
        blockingMissing,
      });
      return;
    }
  }

  const now = new Date();

  // Audit the override BEFORE the transaction commits the schedule, so
  // a transient DB failure on the schedule write doesn't leave an
  // override row pointing at a never-saved schedule. The audit insert
  // is its own statement; if it throws we surface a 500 and don't
  // proceed. `actorIp` falls back to `req.ip` (set by Express's
  // `trust proxy`); user-agent comes straight from the request header.
  if (blockingMissing.length > 0 && overrideBlockingCerts && auth.session.role === "admin") {
    const actorIp =
      typeof req.ip === "string" && req.ip
        ? req.ip
        : (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? null;
    const actorUserAgent =
      typeof req.headers["user-agent"] === "string"
        ? (req.headers["user-agent"] as string)
        : null;
    await db.insert(scheduleCertOverrideAuditLogTable).values({
      ticketId,
      blockingCertifications: blockingCerts,
      missingByEmployee: blockingMissing,
      actorUserId: auth.session.userId,
      actorRole: auth.session.role,
      actorIp,
      actorUserAgent,
    });
    logger.warn(
      {
        ticketId,
        actorUserId: auth.session.userId,
        blockingMissing,
      },
      "schedule cert override applied",
    );
  }

  // Capture the currently-active crew BEFORE the transaction soft-removes
  // them, so we can diff old vs new and notify only those who actually
  // dropped off (Task #634). Workers who remain on the rebuilt crew must
  // not get a "removed" push. The shared `notifyRemovedCrewMember` helper
  // resolves the user id, so we only need the employeeId here.
  const previousCrew = await db
    .select({ employeeId: ticketCrewTable.employeeId })
    .from(ticketCrewTable)
    .where(and(eq(ticketCrewTable.ticketId, ticketId), isNull(ticketCrewTable.removedAt)));
  const newCrewSet = new Set(crewEmployeeIds);
  const droppedCrew = previousCrew.filter(
    (p) => !newCrewSet.has(p.employeeId),
  );

  // Map of employeeId → newly-inserted ticket_crew row's `addedAt`.
  // Captured inside the transaction so the post-commit `crew_added`
  // fan-out below can include the timestamp in the dedupe key, matching
  // the shape used by POST /tickets/:id/crew-roster (Task #631) so a
  // re-schedule of the same person fires a fresh push.
  const addedAtByEmployeeId = new Map<number, Date>();

  // Transaction: replace ticket_crew, update tickets, regenerate scheduled notifications.
  await db.transaction(async (tx) => {
    // Soft-remove all currently-active crew rows.
    await tx
      .update(ticketCrewTable)
      .set({ removedAt: now, removedByUserId: auth.session.userId })
      .where(and(eq(ticketCrewTable.ticketId, ticketId), isNull(ticketCrewTable.removedAt)));

    // Insert new crew rows.
    if (crewEmployeeIds.length > 0) {
      const insertedCrew = await tx
        .insert(ticketCrewTable)
        .values(crewEmployeeIds.map((employeeId) => ({
          ticketId,
          employeeId,
          addedByUserId: auth.session.userId,
        })))
        .returning({
          employeeId: ticketCrewTable.employeeId,
          addedAt: ticketCrewTable.addedAt,
        });
      for (const row of insertedCrew) {
        const ts =
          row.addedAt instanceof Date
            ? row.addedAt
            : new Date(row.addedAt as unknown as string | number);
        addedAtByEmployeeId.set(row.employeeId, ts);
      }
    }

    // Update ticket scheduling fields.
    await tx
      .update(ticketsTable)
      .set({
        scheduledStartAt,
        scheduledDurationMinutes,
        foremanUserId,
        actingForemanUserId,
        scheduledAt: now,
        scheduledById: auth.session.userId,
      })
      .where(eq(ticketsTable.id, ticketId));

    // Drop existing scheduled notifications for this ticket and rebuild.
    await tx
      .delete(ticketScheduledNotificationsTable)
      .where(eq(ticketScheduledNotificationsTable.ticketId, ticketId));

    const userIds = crewRows.map(r => r.userId).filter((u): u is number => u != null);
    if (userIds.length > 0 && warningKinds.length > 0) {
      const notifRows: { ticketId: number; userId: number; kind: string; fireAt: Date }[] = [];
      for (const uid of userIds) {
        for (const kind of warningKinds) {
          notifRows.push({
            ticketId,
            userId: uid,
            kind,
            fireAt: new Date(scheduledStartAt.getTime() - KIND_OFFSET_MS[kind]),
          });
        }
      }
      await tx.insert(ticketScheduledNotificationsTable).values(notifRows);
    }
  });

  // Task #625 / #642 / #649: persistent inbox + push via notifyUsers below
  // (no duplicate in-memory-only ticket_scheduled push).
  const jobLabel = workType?.name ?? "Job";
  const siteLabel = site?.name ?? "site";
  const whenLabel = scheduledStartAt.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  // Task #625 / Task #642 / Task #649: write a persistent notification
  // per crew member so the inbox/badge surfaces it (the
  // `ticket_scheduled` push above is in-memory only and bypasses the
  // notifications table).
  //
  // Routing rules:
  //   - GENUINELY NEW crew member (was not on the active roster
  //     before this POST): emit `crew_added`. The dedupeKey embeds
  //     the new ticket_crew row's `addedAt` ISO timestamp so a
  //     re-add of the same person fires a fresh push — matching the
  //     shape used by POST /tickets/:id/crew-roster (Task #631 /
  //     Task #642).
  //   - ALREADY-ON-ROSTER crew member whose effective scheduled
  //     time or duration actually changed (Task #649): emit
  //     `schedule_changed` instead. This is the more useful signal
  //     ("Your job moved to <new time>") than re-telling them
  //     they're on a ticket they were already on. The dedupeKey
  //     embeds the NEW scheduledStartAt ISO so multiple reschedules
  //     each fire their own push instead of collapsing on the
  //     unique `(user_id, dedupe_key)` index.
  //   - ALREADY-ON-ROSTER crew member whose schedule did NOT change
  //     (e.g. foreman re-saved the modal without touching time/
  //     duration): no persistent notification — they already know
  //     about the ticket and nothing actionable changed for them.
  //
  // Skip the actor's own user id in both branches so a foreman
  // scheduling themselves into the crew doesn't get notified about
  // their own action.
  const previouslyOnRoster = new Set(previousCrew.map((p) => p.employeeId));
  const previousStartMs =
    ticket.previousScheduledStartAt == null
      ? null
      : (ticket.previousScheduledStartAt instanceof Date
          ? ticket.previousScheduledStartAt
          : new Date(ticket.previousScheduledStartAt as unknown as string)
        ).getTime();
  const newStartMs = scheduledStartAt.getTime();
  const previousDurationMinutes =
    ticket.previousScheduledDurationMinutes ?? null;
  const scheduleChanged =
    previousStartMs !== newStartMs ||
    previousDurationMinutes !== scheduledDurationMinutes;
  const newStartIso = scheduledStartAt.toISOString();
  for (const r of crewRows) {
    if (!r.userId) continue;
    if (r.userId === auth.session.userId) continue;
    if (previouslyOnRoster.has(r.id)) {
      // Same person, still on the roster — only ping them when the
      // time/duration actually moved.
      if (!scheduleChanged) continue;
      try {
        await notifyUsers([r.userId], {
          type: "schedule_changed",
          title: "Your job's start time changed",
          body: `${jobLabel} at ${siteLabel} now starts ${whenLabel}.`,
          link: `/tickets/${ticketId}`,
          // Embedding the NEW start ISO is what unblocks repeated
          // reschedules on the unique `(user_id, dedupe_key)` index:
          // each distinct start time produces a distinct key.
          dedupeKey: `schedule_changed:${ticketId}:${r.id}:${newStartIso}`,
          pushData: { ticketId, type: "schedule_changed" },
        });
      } catch (err) {
        logger.warn(
          { err, ticketId, employeeId: r.id, userId: r.userId },
          "schedule_changed notify failed",
        );
      }
      continue;
    }
    // Genuinely new crew member — keep the established `crew_added`
    // contract (Task #625 / Task #631 / Task #642).
    const addedAt = addedAtByEmployeeId.get(r.id);
    // If the insert returning didn't surface a row for this employee,
    // fall back to the per-request `now` so the dedupe key is still
    // unique to this scheduling event rather than collapsing to the
    // legacy `(ticketId, employeeId)` key.
    const addedAtIso = (addedAt ?? now).toISOString();
    try {
      await notifyUsers([r.userId], {
        type: "crew_added",
        title: "You've been added to a ticket",
        body: `Tracking ${formatTicketTrackingNumber(ticketId)} — tap to see the job.`,
        link: `/tickets/${ticketId}`,
        dedupeKey: `crew_added:${ticketId}:${r.id}:${addedAtIso}`,
        // Mobile deep-link routing reads `data.ticketId`.
        pushData: { ticketId, type: "crew_added" },
      });
    } catch (err) {
      logger.warn(
        { err, ticketId, employeeId: r.id, userId: r.userId },
        "crew_added notify failed",
      );
    }
  }

  // Task #634: tell crew members who actually dropped off the ticket that
  // they were removed. `droppedCrew` was computed before the transaction
  // by diffing the previously-active crew against the new `crewEmployeeIds`,
  // so workers who remain on the rebuilt crew are not spammed. Reuses the
  // shared `notifyRemovedCrewMember` helper from the DELETE route so the
  // payload (link, dedupe-key shape, pushData) stays consistent across
  // both removal paths.
  for (const p of droppedCrew) {
    void notifyRemovedCrewMember({
      ticketId,
      employeeId: p.employeeId,
      removedAt: now,
    }).catch(() => undefined);
  }

  res.status(200).json({
    ok: true,
    ticketId,
    scheduledStartAt: scheduledStartAt.toISOString(),
    scheduledDurationMinutes,
    foremanUserId,
    actingForemanUserId,
    crewEmployeeIds,
    warningKinds,
    certWarnings,
    certExpiringSoon,
  });
}

router.post("/tickets/:id/schedule", handleScheduleTicketRequest);

// ── GET /api/tickets/:id/schedule ─────────────────────────────────────
// Returns the current schedule + crew + warnings for a ticket. Same auth
// as the scheduler (vendor admin / foreman), so we can prefill the modal.
router.get("/tickets/:id/schedule", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const auth = await ensureSchedulerAuth(req, res, ticketId);
  if (!auth) return;

  const [t] = await db
    .select({
      scheduledStartAt: ticketsTable.scheduledStartAt,
      scheduledDurationMinutes: ticketsTable.scheduledDurationMinutes,
      foremanUserId: ticketsTable.foremanUserId,
      actingForemanUserId: ticketsTable.actingForemanUserId,
      scheduledAt: ticketsTable.scheduledAt,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));

  const crew = await db
    .select({
      employeeId: ticketCrewTable.employeeId,
      userId: vendorPeopleTable.userId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
    })
    .from(ticketCrewTable)
    .leftJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
    .where(and(eq(ticketCrewTable.ticketId, ticketId), isNull(ticketCrewTable.removedAt)));

  const warningRows = await db
    .selectDistinct({ kind: ticketScheduledNotificationsTable.kind })
    .from(ticketScheduledNotificationsTable)
    .where(eq(ticketScheduledNotificationsTable.ticketId, ticketId));

  res.json({
    scheduledStartAt: t?.scheduledStartAt ?? null,
    scheduledDurationMinutes: t?.scheduledDurationMinutes ?? null,
    foremanUserId: t?.foremanUserId ?? null,
    actingForemanUserId: t?.actingForemanUserId ?? null,
    scheduledAt: t?.scheduledAt ?? null,
    crew: crew.map(c => ({
      employeeId: c.employeeId,
      userId: c.userId,
      name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
    })),
    warningKinds: warningRows.map(w => w.kind),
  });
});

// ── POST /api/tickets/:id/schedule/resend-notifications ───────────────
// Manually re-notify the current crew. Useful when someone missed the
// original push/in-app row (re-save without schedule changes sends nothing)
// or when a dispatcher wants to ping the team again.
router.post("/tickets/:id/schedule/resend-notifications", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
    return;
  }
  const auth = await ensureSchedulerAuth(req, res, ticketId);
  if (!auth) return;

  const [ticket] = await db
    .select({
      scheduledStartAt: ticketsTable.scheduledStartAt,
      workTypeId: ticketsTable.workTypeId,
      siteLocationId: ticketsTable.siteLocationId,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!ticket?.scheduledStartAt) {
    res.status(409).json({
      error: "not_scheduled",
      message: "Ticket is not scheduled",
      code: "schedule.not_scheduled",
    });
    return;
  }

  const body = req.body ?? {};
  let crewEmployeeIds: number[];
  if (Array.isArray(body.crewEmployeeIds)) {
    crewEmployeeIds = body.crewEmployeeIds
      .map((n: unknown) => Number(n))
      .filter((n: number) => Number.isFinite(n));
  } else {
    const rows = await db
      .select({ employeeId: ticketCrewTable.employeeId })
      .from(ticketCrewTable)
      .where(and(eq(ticketCrewTable.ticketId, ticketId), isNull(ticketCrewTable.removedAt)));
    crewEmployeeIds = rows.map((r) => r.employeeId);
  }

  if (crewEmployeeIds.length === 0) {
    res.status(400).json({
      error: "crew_required",
      message: "Assign at least one crew member",
      code: "schedule.crew_required",
    });
    return;
  }

  const crewRows = await db
    .select({
      id: vendorPeopleTable.id,
      userId: vendorPeopleTable.userId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
    })
    .from(vendorPeopleTable)
    .where(
      and(
        inArray(vendorPeopleTable.id, crewEmployeeIds),
        eq(vendorPeopleTable.vendorId, auth.vendorId),
        isNull(vendorPeopleTable.deletedAt),
      ),
    );

  const [workType] = ticket.workTypeId
    ? await db
        .select({ name: workTypesTable.name })
        .from(workTypesTable)
        .where(eq(workTypesTable.id, ticket.workTypeId))
    : [];
  const [site] = ticket.siteLocationId
    ? await db
        .select({
          name: siteLocationsTable.name,
          partnerId: siteLocationsTable.partnerId,
        })
        .from(siteLocationsTable)
        .where(eq(siteLocationsTable.id, ticket.siteLocationId))
    : [];
  const [partner] = site?.partnerId
    ? await db
        .select({ name: partnersTable.name })
        .from(partnersTable)
        .where(eq(partnersTable.id, site.partnerId))
    : [];

  const scheduledStartAt =
    ticket.scheduledStartAt instanceof Date
      ? ticket.scheduledStartAt
      : new Date(ticket.scheduledStartAt as unknown as string);
  const jobLabel = workType?.name ?? "Job";
  const siteLabel = site?.name ?? "site";
  const partnerLabel = partner?.name ?? "";
  const whenLabel = scheduledStartAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const resendIso = new Date().toISOString();

  let notified = 0;
  let skippedNoLogin = 0;
  for (const r of crewRows) {
    if (!r.userId) {
      skippedNoLogin += 1;
      continue;
    }
    if (r.userId === auth.session.userId) continue;

    try {
      const n = await notifyUsers([r.userId], {
        type: "schedule_changed",
        title: "Job schedule reminder",
        body: `${jobLabel} at ${siteLabel} starts ${whenLabel}.`,
        link: `/tickets/${ticketId}`,
        dedupeKey: `schedule_resend:${ticketId}:${r.id}:${resendIso}`,
        pushData: { ticketId, type: "schedule_changed" },
      });
      if (n > 0) notified += n;
    } catch (err) {
      logger.warn(
        { err, ticketId, employeeId: r.id, userId: r.userId },
        "schedule_resend notify failed",
      );
    }
  }

  res.status(200).json({ ok: true, notified, skippedNoLogin, crewCount: crewRows.length });
});

// ── GET /api/me/upcoming-schedule?days=14 ─────────────────────────────
router.get("/me/upcoming-schedule", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" }); return; }
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  const horizon = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // Find vendor_people row for this user (if any), so we can resolve which
  // tickets they are crewed onto.
  const [me] = await db
    .select({ id: vendorPeopleTable.id })
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.userId, session.userId), isNull(vendorPeopleTable.deletedAt)));

  const ticketIdSet = new Set<number>();
  if (me) {
    const crewRows = await db
      .select({ ticketId: ticketCrewTable.ticketId })
      .from(ticketCrewTable)
      .where(and(eq(ticketCrewTable.employeeId, me.id), isNull(ticketCrewTable.removedAt)));
    crewRows.forEach(r => ticketIdSet.add(r.ticketId));
  }
  // Also include any ticket where the user is the foreman.
  const foremanRows = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(eq(ticketsTable.foremanUserId, session.userId));
  foremanRows.forEach(r => ticketIdSet.add(r.id));

  if (ticketIdSet.size === 0) { res.json({ tickets: [] }); return; }

  const ticketIds = Array.from(ticketIdSet);
  const rows = await db
    .select({
      id: ticketsTable.id,
      scheduledStartAt: ticketsTable.scheduledStartAt,
      scheduledDurationMinutes: ticketsTable.scheduledDurationMinutes,
      foremanUserId: ticketsTable.foremanUserId,
      status: ticketsTable.status,
      siteLocationId: ticketsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      siteAddress: siteLocationsTable.address,
      siteLatitude: siteLocationsTable.latitude,
      siteLongitude: siteLocationsTable.longitude,
      partnerName: partnersTable.name,
      vendorName: vendorsTable.name,
      workTypeName: workTypesTable.name,
      // Task #605: mobile schedule pill shares the web 7-day inactivity
      // escalation; surfacing updatedAt lets the client decide.
      updatedAt: ticketsTable.updatedAt,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .leftJoin(vendorsTable, eq(ticketsTable.vendorId, vendorsTable.id))
    .leftJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
    .where(and(
      inArray(ticketsTable.id, ticketIds),
      // upcoming only: scheduled_start_at in [now - 1h, horizon]
      gte(ticketsTable.scheduledStartAt, new Date(Date.now() - 60 * 60 * 1000)),
      lte(ticketsTable.scheduledStartAt, horizon),
    ))
    .orderBy(asc(ticketsTable.scheduledStartAt));

  // Pull crewmates + foreman names for each ticket.
  const ticketIdsFinal = rows.map(r => r.id);
  const crewmates = ticketIdsFinal.length > 0 ? await db
    .select({
      ticketId: ticketCrewTable.ticketId,
      employeeId: vendorPeopleTable.id,
      userId: vendorPeopleTable.userId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      ackStatus: ticketCrewTable.ackStatus,
    })
    .from(ticketCrewTable)
    .leftJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
    .where(and(inArray(ticketCrewTable.ticketId, ticketIdsFinal), isNull(ticketCrewTable.removedAt)))
    : [];

  const foremanIds = Array.from(new Set(rows.map(r => r.foremanUserId).filter((x): x is number => x != null)));
  const foremen = foremanIds.length > 0 ? await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(inArray(usersTable.id, foremanIds))
    : [];
  const foremanById = new Map(foremen.map(f => [f.id, f.displayName ?? ""]));

  const tickets = rows.map(r => ({
    id: r.id,
    scheduledStartAt: r.scheduledStartAt,
    scheduledDurationMinutes: r.scheduledDurationMinutes,
    status: r.status,
    updatedAt: r.updatedAt,
    siteName: r.siteName,
    siteAddress: r.siteAddress,
    siteLatitude: r.siteLatitude,
    siteLongitude: r.siteLongitude,
    partnerName: r.partnerName,
    vendorName: r.vendorName,
    workTypeName: r.workTypeName,
    foremanUserId: r.foremanUserId,
    foremanName: r.foremanUserId != null ? foremanById.get(r.foremanUserId) ?? "" : "",
    isForeman: r.foremanUserId === session.userId,
    myAckStatus:
      crewmates.find(c => c.ticketId === r.id && c.userId === session.userId)?.ackStatus ?? null,
    crew: crewmates
      .filter(c => c.ticketId === r.id)
      .map(c => ({
        employeeId: c.employeeId,
        userId: c.userId,
        name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
        isMe: c.userId === session.userId,
        ackStatus: c.ackStatus ?? "pending",
      })),
  }));

  res.json({ tickets });
});

// ── POST /api/tickets/:id/crew/ack ─────────────────────────────────────
// Crew member confirms or declines an assignment.
router.post("/tickets/:id/crew/ack", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" }); return; }

  const status = String(req.body?.status ?? "");
  if (status !== "confirmed" && status !== "declined") {
    res.status(400).json({ error: "status must be 'confirmed' or 'declined'", code: "schedule.invalid_ack_status" });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null;

  // Find the active ticket_crew row for this user on this ticket via vendor_people lookup.
  const [me] = await db
    .select({ id: vendorPeopleTable.id })
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.userId, session.userId), isNull(vendorPeopleTable.deletedAt)));
  if (!me) { res.status(403).json({ error: "Not on crew", code: "schedule.not_on_crew" }); return; }

  const result = await db
    .update(ticketCrewTable)
    .set({ ackStatus: status, ackAt: new Date(), ackNote: note })
    .where(and(
      eq(ticketCrewTable.ticketId, ticketId),
      eq(ticketCrewTable.employeeId, me.id),
      isNull(ticketCrewTable.removedAt),
    ))
    .returning({ id: ticketCrewTable.id });
  if (result.length === 0) { res.status(404).json({ error: "Not assigned to this ticket", code: "schedule.not_assigned" }); return; }

  res.json({ ok: true, status, ackAt: new Date().toISOString() });
});

// ── GET /api/tickets/:id/crew-tracker ──────────────────────────────────
// Returns each crew member with last live ping + distance + ETA to site.
// Auth: scheduler-grade (admin / vendor admin / foreman of this ticket).
router.get("/tickets/:id/crew-tracker", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const auth = await ensureSchedulerAuth(req, res, ticketId);
  if (!auth) return;

  // Site (with lat/lng for ETA target).
  const [t] = await db
    .select({
      siteLocationId: ticketsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      siteLatitude: siteLocationsTable.latitude,
      siteLongitude: siteLocationsTable.longitude,
      scheduledStartAt: ticketsTable.scheduledStartAt,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, ticketId));
  if (!t) { res.status(404).json({ error: "Ticket not found", code: "ticket.not_found" }); return; }

  // Crew members (active).
  const crew = await db
    .select({
      employeeId: ticketCrewTable.employeeId,
      ackStatus: ticketCrewTable.ackStatus,
      ackAt: ticketCrewTable.ackAt,
      userId: vendorPeopleTable.userId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
    })
    .from(ticketCrewTable)
    .leftJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
    .where(and(eq(ticketCrewTable.ticketId, ticketId), isNull(ticketCrewTable.removedAt)));

  // For each crew member with a userId, find the most recent live_ping
  // across ANY ticket they're field_employee_id of, within last 24h.
  const sinceTs = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const userIds = crew.map(c => c.userId).filter((u): u is number => u != null);
  const empIdsByUser = new Map<number, number[]>();
  if (userIds.length > 0) {
    const allEmps = await db
      .select({ id: vendorPeopleTable.id, userId: vendorPeopleTable.userId })
      .from(vendorPeopleTable)
      .where(and(inArray(vendorPeopleTable.userId, userIds), isNull(vendorPeopleTable.deletedAt)));
    for (const e of allEmps) {
      if (e.userId == null) continue;
      const arr = empIdsByUser.get(e.userId) ?? [];
      arr.push(e.id);
      empIdsByUser.set(e.userId, arr);
    }
  }

  // Latest live ping per (this) ticket-OR-anything-the-user-is-on. We just
  // pull the most recent live_ping per ticket in the freshness window, then
  // map back to users via the field_employee_id mapping below.
  const pingsByTicket = new Map<number, { lat: number; lng: number; recordedAt: Date; battery: number | null }>();
  const allEmpIds = Array.from(new Set(Array.from(empIdsByUser.values()).flat()));
  if (allEmpIds.length > 0) {
    const userTickets = await db
      .select({ id: ticketsTable.id, fieldEmployeeId: ticketsTable.fieldEmployeeId })
      .from(ticketsTable)
      .where(inArray(ticketsTable.fieldEmployeeId, allEmpIds));
    const userTicketIds = userTickets.map(x => x.id);
    if (userTicketIds.length > 0) {
      const pingsRes = await db.execute(sql`
        SELECT g.ticket_id AS "ticketId", g.latitude, g.longitude, g.battery_level AS "batteryLevel", g.recorded_at AS "recordedAt"
          FROM ${gpsLogsTable} g
          JOIN (
            SELECT ticket_id, MAX(id) AS max_id
              FROM ${gpsLogsTable}
             WHERE event_type = 'live_ping'
               AND recorded_at >= ${sinceTs}
               AND ticket_id IN (${sql.join(userTicketIds.map(id => sql`${id}`), sql`, `)})
             GROUP BY ticket_id
          ) latest ON latest.ticket_id = g.ticket_id AND latest.max_id = g.id
      `);
      for (const r of (pingsRes as any).rows ?? (pingsRes as any)) {
        pingsByTicket.set(Number(r.ticketId), {
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          battery: r.batteryLevel == null ? null : Number(r.batteryLevel),
          recordedAt: new Date(r.recordedAt),
        });
      }
      // Map ticket→empId
      const empByTicket = new Map<number, number>();
      for (const ut of userTickets) {
        if (ut.fieldEmployeeId != null) empByTicket.set(ut.id, ut.fieldEmployeeId);
      }
      // Pick freshest ping per emp.
      const freshestByEmp = new Map<number, { lat: number; lng: number; recordedAt: Date; battery: number | null }>();
      for (const [tid, ping] of pingsByTicket) {
        const empId = empByTicket.get(tid);
        if (empId == null) continue;
        const cur = freshestByEmp.get(empId);
        if (!cur || ping.recordedAt > cur.recordedAt) freshestByEmp.set(empId, ping);
      }
      // Repurpose pingsByTicket as a freshest-by-emp store via empty key=empId
      pingsByTicket.clear();
      for (const [empId, p] of freshestByEmp) pingsByTicket.set(empId, p);
    }
  }

  const siteLat = t.siteLatitude != null ? Number(t.siteLatitude) : null;
  const siteLng = t.siteLongitude != null ? Number(t.siteLongitude) : null;

  const out = crew.map(c => {
    const empIds = c.userId != null ? (empIdsByUser.get(c.userId) ?? [c.employeeId]) : [c.employeeId];
    let bestPing: { lat: number; lng: number; recordedAt: Date; battery: number | null } | null = null;
    for (const eid of empIds) {
      const p = pingsByTicket.get(eid);
      if (p && (!bestPing || p.recordedAt > bestPing.recordedAt)) bestPing = p;
    }
    let distanceMeters: number | null = null;
    let etaMinutes: number | null = null;
    if (bestPing && siteLat != null && siteLng != null) {
      distanceMeters = haversineMeters({ lat: bestPing.lat, lng: bestPing.lng }, { lat: siteLat, lng: siteLng });
      etaMinutes = etaMinutesFromMeters(distanceMeters);
    }
    return {
      employeeId: c.employeeId,
      userId: c.userId,
      name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || `Employee #${c.employeeId}`,
      ackStatus: c.ackStatus,
      ackAt: c.ackAt,
      lastPing: bestPing
        ? { latitude: bestPing.lat, longitude: bestPing.lng, recordedAt: bestPing.recordedAt, batteryLevel: bestPing.battery }
        : null,
      distanceMeters,
      etaMinutes,
    };
  });

  res.json({
    ticketId,
    site: { name: t.siteName, latitude: siteLat, longitude: siteLng },
    scheduledStartAt: t.scheduledStartAt,
    avgRoadSpeedKmh: AVG_ROAD_SPEED_KMH,
    crew: out,
  });
});

// ── GET /api/tickets/:id/schedule.ics ──────────────────────────────────
// RFC 5545 text-value escaping. Order matters: backslash first, then the rest.
// Bare CR or LF (and the CRLF pair) collapse to the literal "\\n" sequence so
// no raw line breaks leak into a property value (which would corrupt parsing).
function escapeICS(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}
// RFC 5545 §3.1 long content lines must be folded at <=75 octets followed by
// CRLF + a single space continuation. We fold by codepoint position rather
// than octet count which is conservative for ASCII (which is all we emit here).
function foldICSLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  out.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    out.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return out.join("\r\n");
}
function formatICSDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
router.get("/tickets/:id/schedule.ics", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const auth = await ensureScheduleOrCrewAuth(req, res, ticketId);
  if (!auth) return;

  const [t] = await db
    .select({
      scheduledStartAt: ticketsTable.scheduledStartAt,
      scheduledDurationMinutes: ticketsTable.scheduledDurationMinutes,
      siteName: siteLocationsTable.name,
      siteAddress: siteLocationsTable.address,
      partnerName: partnersTable.name,
      workTypeName: workTypesTable.name,
      vendorName: vendorsTable.name,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .leftJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
    .leftJoin(vendorsTable, eq(ticketsTable.vendorId, vendorsTable.id))
    .where(eq(ticketsTable.id, ticketId));
  if (!t || !t.scheduledStartAt) { res.status(409).json({ error: "Ticket is not scheduled", code: "schedule.not_scheduled" }); return; }

  const start: Date = t.scheduledStartAt as Date;
  const end = new Date(start.getTime() + ((t.scheduledDurationMinutes ?? 60) * 60 * 1000));
  const summary = `${t.workTypeName ?? "Field Job"} — ${t.partnerName ?? ""}`.trim();
  const description = [
    `Ticket #${ticketId}`,
    t.vendorName ? `Vendor: ${t.vendorName}` : null,
    t.partnerName ? `Operator: ${t.partnerName}` : null,
    t.workTypeName ? `Work Type: ${t.workTypeName}` : null,
  ].filter(Boolean).join("\n");
  const location = [t.siteName, t.siteAddress].filter(Boolean).join(" — ");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VNDRLY//Field Ops//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:vndrly-ticket-${ticketId}@vndrly`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(start)}`,
    `DTEND:${formatICSDate(end)}`,
    `SUMMARY:${escapeICS(summary)}`,
    `DESCRIPTION:${escapeICS(description)}`,
    location ? `LOCATION:${escapeICS(location)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).map((l) => foldICSLine(l as string)).join("\r\n");

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="vndrly-ticket-${ticketId}.ics"`);
  res.send(lines);
});

// ── Lookup-endpoint auth helpers ───────────────────────────────────────
// The two helper endpoints below (`required-certifications`, `weather`)
// don't take a ticket id, so we can't reuse `ensureSchedulerAuth`
// directly. They still need to be locked down to the same set of
// callers (admin, vendor admin, or assigned foreman/crew) — otherwise
// any logged-in user could enumerate weather forecasts by site id or
// required certifications by work-type id (Task #228). The helpers
// reject anyone who can't tie themselves to at least one ticket on the
// resource being looked up.

async function ensureSiteSchedulerLookupAuth(
  req: any,
  res: any,
  siteId: number,
): Promise<Session | null> {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      error: "not_authenticated",
      message: "Not authenticated",
      code: "auth.not_authenticated",
    });
    return null;
  }
  if (session.role === "admin") return session;

  if (session.role === "vendor" && session.vendorId != null) {
    // Vendor admins can look up weather for sites they're scheduling
    // work at. Vendor "members" (non-admin) cannot, matching the
    // existing scheduler-grade gating in `ensureSchedulerAuth`.
    const [adminMembership] = await db
      .select({ id: userOrgMembershipsTable.id })
      .from(userOrgMembershipsTable)
      .where(and(
        eq(userOrgMembershipsTable.userId, session.userId),
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, session.vendorId),
        eq(userOrgMembershipsTable.role, "admin"),
      ));
    if (adminMembership) {
      const [t] = await db
        .select({ id: ticketsTable.id })
        .from(ticketsTable)
        .where(and(
          eq(ticketsTable.siteLocationId, siteId),
          eq(ticketsTable.vendorId, session.vendorId),
        ))
        .limit(1);
      if (t) return session;
    }
  }

  if (session.role === "field_employee") {
    // Field employees: must be the foreman, or actively on the crew,
    // of at least one ticket at this site. `removedAt IS NULL` keeps
    // dropped crew members from re-gaining access via stale rows.
    const [foremanTicket] = await db
      .select({ id: ticketsTable.id })
      .from(ticketsTable)
      .where(and(
        eq(ticketsTable.siteLocationId, siteId),
        eq(ticketsTable.foremanUserId, session.userId),
      ))
      .limit(1);
    if (foremanTicket) return session;

    const [crewTicket] = await db
      .select({ id: ticketCrewTable.id })
      .from(ticketCrewTable)
      .innerJoin(ticketsTable, eq(ticketCrewTable.ticketId, ticketsTable.id))
      .innerJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
      .where(and(
        eq(ticketsTable.siteLocationId, siteId),
        eq(vendorPeopleTable.userId, session.userId),
        isNull(ticketCrewTable.removedAt),
      ))
      .limit(1);
    if (crewTicket) return session;
  }

  res.status(403).json({
    error: "forbidden_not_scheduler",
    message: "Not allowed",
    code: "site.no_access",
  });
  return null;
}

async function ensureWorkTypeSchedulerLookupAuth(
  req: any,
  res: any,
  workTypeId: number,
): Promise<Session | null> {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      error: "not_authenticated",
      message: "Not authenticated",
      code: "auth.not_authenticated",
    });
    return null;
  }
  if (session.role === "admin") return session;

  if (session.role === "vendor" && session.vendorId != null) {
    const [adminMembership] = await db
      .select({ id: userOrgMembershipsTable.id })
      .from(userOrgMembershipsTable)
      .where(and(
        eq(userOrgMembershipsTable.userId, session.userId),
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, session.vendorId),
        eq(userOrgMembershipsTable.role, "admin"),
      ));
    if (adminMembership) {
      const [t] = await db
        .select({ id: ticketsTable.id })
        .from(ticketsTable)
        .where(and(
          eq(ticketsTable.workTypeId, workTypeId),
          eq(ticketsTable.vendorId, session.vendorId),
        ))
        .limit(1);
      if (t) return session;
    }
  }

  if (session.role === "field_employee") {
    const [foremanTicket] = await db
      .select({ id: ticketsTable.id })
      .from(ticketsTable)
      .where(and(
        eq(ticketsTable.workTypeId, workTypeId),
        eq(ticketsTable.foremanUserId, session.userId),
      ))
      .limit(1);
    if (foremanTicket) return session;

    const [crewTicket] = await db
      .select({ id: ticketCrewTable.id })
      .from(ticketCrewTable)
      .innerJoin(ticketsTable, eq(ticketCrewTable.ticketId, ticketsTable.id))
      .innerJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
      .where(and(
        eq(ticketsTable.workTypeId, workTypeId),
        eq(vendorPeopleTable.userId, session.userId),
        isNull(ticketCrewTable.removedAt),
      ))
      .limit(1);
    if (crewTicket) return session;
  }

  res.status(403).json({
    error: "forbidden_not_scheduler",
    message: "Not allowed",
    code: "work_type.no_access",
  });
  return null;
}

// ── GET /api/work-types/:id/required-certifications ────────────────────
router.get("/work-types/:id/required-certifications", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const session = await ensureWorkTypeSchedulerLookupAuth(req, res, id);
  if (!session) return;
  const [wt] = await db
    .select({ id: workTypesTable.id, name: workTypesTable.name, requiredCertifications: workTypesTable.requiredCertifications })
    .from(workTypesTable)
    .where(eq(workTypesTable.id, id));
  if (!wt) { res.status(404).json({ error: "Not found", code: "work_type.not_found" }); return; }
  res.json({ id: wt.id, name: wt.name, requiredCertifications: (wt.requiredCertifications as string[] | null) ?? [] });
});

// ── GET /api/sites/:id/weather ─────────────────────────────────────────
// Open-Meteo proxy. No API key needed. Returns the forecast hour closest
// to ?at=ISO (defaults to now). Caches per (siteId, hour) for 30 min.
const weatherCache = new Map<string, { fetchedAt: number; data: any }>();
router.get("/sites/:id/weather", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const session = await ensureSiteSchedulerLookupAuth(req, res, id);
  if (!session) return;
  const atParam = typeof req.query.at === "string" ? req.query.at : null;
  const at = atParam ? new Date(atParam) : new Date();
  if (Number.isNaN(at.getTime())) { res.status(400).json({ error: "Invalid at", code: "validation.invalid_at" }); return; }

  const [site] = await db
    .select({ latitude: siteLocationsTable.latitude, longitude: siteLocationsTable.longitude, name: siteLocationsTable.name })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, id));
  if (!site || site.latitude == null || site.longitude == null) {
    res.status(404).json({ error: "Site missing coordinates", code: "site.missing_coordinates" });
    return;
  }

  const hourKey = new Date(Math.floor(at.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000).toISOString();
  const cacheKey = `${id}|${hourKey}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 30 * 60 * 1000) {
    res.json(cached.data);
    return;
  }

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(Number(site.latitude)));
    url.searchParams.set("longitude", String(Number(site.longitude)));
    url.searchParams.set("hourly", "temperature_2m,precipitation_probability,wind_speed_10m,weather_code");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("forecast_days", "3");
    url.searchParams.set("timezone", "UTC");

    const r = await fetch(url.toString());
    if (!r.ok) { res.status(502).json({ error: "weather upstream error", code: "weather.upstream_error" }); return; }
    const j: any = await r.json();
    const times: string[] = j?.hourly?.time ?? [];
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const ts = new Date(times[i] + "Z").getTime();
      const diff = Math.abs(ts - at.getTime());
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    const data = bestIdx >= 0 ? {
      siteName: site.name,
      time: times[bestIdx],
      temperatureF: j.hourly.temperature_2m?.[bestIdx] ?? null,
      precipitationProbability: j.hourly.precipitation_probability?.[bestIdx] ?? null,
      windMph: j.hourly.wind_speed_10m?.[bestIdx] ?? null,
      weatherCode: j.hourly.weather_code?.[bestIdx] ?? null,
    } : { siteName: site.name, time: null, temperatureF: null, precipitationProbability: null, windMph: null, weatherCode: null };
    weatherCache.set(cacheKey, { fetchedAt: Date.now(), data });
    res.json(data);
  } catch (err) {
    logger.warn({ err, siteId: id }, "weather fetch failed");
    res.status(502).json({ error: "weather upstream error", code: "weather.upstream_error" });
  }
});

export default router;

// ── Background worker: dispatch due scheduled notifications ────────────
// Runs once per minute. Atomically claims rows whose fire_at has passed and
// sent_at is null, then sends an Expo push to each user and inserts a row
// into the in-app notifications feed. Best-effort — failed pushes still mark
// sent_at so we don't keep retrying forever.

let workerTimer: NodeJS.Timeout | null = null;

async function dispatchDueNotifications(): Promise<void> {
  // Atomically claim due rows: set sent_at=now() in a single update returning the rows.
  // This guarantees we never double-send even if multiple workers run.
  const claimed = await db.execute(sql`
    UPDATE ticket_scheduled_notifications
    SET sent_at = NOW()
    WHERE id IN (
      SELECT id FROM ticket_scheduled_notifications
      WHERE sent_at IS NULL AND fire_at <= NOW()
      ORDER BY fire_at ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, ticket_id AS "ticketId", user_id AS "userId", kind, fire_at AS "fireAt"
  `);
  const rows = (claimed as unknown as { rows: Array<{ id: number; ticketId: number; userId: number; kind: string }> }).rows
    ?? (claimed as unknown as Array<{ id: number; ticketId: number; userId: number; kind: string }>);
  if (!rows || rows.length === 0) return;

  // Group by ticketId so we make one ticket lookup per distinct ticket.
  const byTicket = new Map<number, Array<{ userId: number; kind: string }>>();
  for (const r of rows) {
    const list = byTicket.get(r.ticketId) ?? [];
    list.push({ userId: r.userId, kind: r.kind });
    byTicket.set(r.ticketId, list);
  }

  for (const [ticketId, items] of byTicket) {
    const [t] = await db
      .select({
        scheduledStartAt: ticketsTable.scheduledStartAt,
        siteName: siteLocationsTable.name,
        siteAddress: siteLocationsTable.address,
        partnerName: partnersTable.name,
        workTypeName: workTypesTable.name,
      })
      .from(ticketsTable)
      .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
      .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
      .leftJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
      .where(eq(ticketsTable.id, ticketId));
    if (!t) continue;

    for (const item of items) {
      const titleByKind: Record<string, string> = {
        "3d": "In 3 days",
        "2d": "In 2 days",
        "1d": "Tomorrow (24h)",
        "12h": "In 12 hours",
        "4h": "In ~4 hours",
        "1h": "Starting soon (1h)",
        "start": "Starting now",
      };
      const job = t.workTypeName ?? "Job";
      const where = `${t.partnerName ? t.partnerName + " — " : ""}${t.siteName ?? "site"}`;
      const title = `${titleByKind[item.kind] ?? "Reminder"}: ${job}`;
      const body = `${where}${t.siteAddress ? "\n" + t.siteAddress : ""}\nOpen in VNDRLY to view this ticket.`;

      // Insert into the in-app feed (dedupe per user × ticket × kind).
      try {
        await db.execute(sql`
          INSERT INTO notifications (user_id, type, category, dedupe_key, title, body, link)
          VALUES (
            ${item.userId},
            'ticket_warning',
            'tickets',
            ${`ticket-warning-${ticketId}-${item.kind}`},
            ${title},
            ${body},
            ${`/tickets/${ticketId}`}
          )
          ON CONFLICT DO NOTHING
        `);
      } catch (err) {
        logger.warn({ err, ticketId, userId: item.userId, kind: item.kind }, "scheduled notif insert failed");
      }

      void fanOutPushToUser(item.userId, {
        type: "ticket_warning",
        title,
        body,
        link: `/tickets/${ticketId}`,
        category: "tickets",
        pushData: { ticketId, kind: item.kind, type: "ticket_warning" },
      }).catch(() => undefined);
    }
  }
}

// ── Late-arrival nudge: if a scheduled ticket has started and the foreman/
// crew is within the site geofence but hasn't checked in, ping them once.
async function dispatchLateCheckInNudges(): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 4 * 60 * 60 * 1000); // ignore very old tickets

  // Candidate tickets: scheduled to start by now, not yet nudged, not in
  // a "checked-in / progressing / closed / cancelled" lifecycle, with site coords.
  const candidates = await db.execute(sql`
    SELECT t.id                       AS "ticketId",
           t.scheduled_start_at       AS "scheduledStartAt",
           t.site_location_id         AS "siteLocationId",
           s.latitude                 AS "siteLat",
           s.longitude                AS "siteLng",
           COALESCE(s.site_radius_meters, 250) AS "radius",
           s.name                     AS "siteName"
      FROM ${ticketsTable} t
      JOIN ${siteLocationsTable} s ON s.id = t.site_location_id
     WHERE t.scheduled_start_at IS NOT NULL
       AND t.scheduled_start_at <= ${now}
       AND t.scheduled_start_at >= ${windowStart}
       AND COALESCE(t.lifecycle_state, '') NOT IN ('checked_in','in_progress','completed','cancelled')
       AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
     LIMIT 50
  `);
  const cRows: any[] = (candidates as any).rows ?? (candidates as any);
  if (!cRows || cRows.length === 0) return;

  for (const c of cRows) {
    const ticketId = Number(c.ticketId);
    const siteLat = Number(c.siteLat);
    const siteLng = Number(c.siteLng);
    const radius = Number(c.radius);
    const siteName = String(c.siteName ?? "the site");

    // Active crew with userId.
    const crew = await db
      .select({
        crewId: ticketCrewTable.id,
        employeeId: ticketCrewTable.employeeId,
        enRouteSentAt: ticketCrewTable.enRouteRemindSentAt,
        userId: vendorPeopleTable.userId,
      })
      .from(ticketCrewTable)
      .leftJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
      .where(and(eq(ticketCrewTable.ticketId, ticketId), isNull(ticketCrewTable.removedAt)));

    let anyNudged = false;
    for (const member of crew) {
      if (member.userId == null || member.enRouteSentAt != null) continue;

      // Find any vendor_people row for this user, then their tickets, then most recent live_ping.
      const empRows = await db
        .select({ id: vendorPeopleTable.id })
        .from(vendorPeopleTable)
        .where(and(eq(vendorPeopleTable.userId, member.userId), isNull(vendorPeopleTable.deletedAt)));
      const empIds = empRows.map(r => r.id);
      if (empIds.length === 0) continue;

      const ticketsForUser = await db
        .select({ id: ticketsTable.id })
        .from(ticketsTable)
        .where(inArray(ticketsTable.fieldEmployeeId, empIds));
      const userTicketIds = ticketsForUser.map(t => t.id);
      if (userTicketIds.length === 0) continue;

      const recent = await db.execute(sql`
        SELECT latitude, longitude, recorded_at AS "recordedAt"
          FROM ${gpsLogsTable}
         WHERE event_type = 'live_ping'
           AND recorded_at >= ${new Date(Date.now() - 60 * 60 * 1000)}
           AND ticket_id IN (${sql.join(userTicketIds.map(id => sql`${id}`), sql`, `)})
         ORDER BY id DESC
         LIMIT 1
      `);
      const recentRows: any[] = (recent as any).rows ?? (recent as any);
      const ping = recentRows?.[0];
      if (!ping) continue;

      const dist = haversineMeters(
        { lat: Number(ping.latitude), lng: Number(ping.longitude) },
        { lat: siteLat, lng: siteLng },
      );
      if (dist > radius) continue;

      // Mark per-crew row first to avoid duplicate sends across ticks.
      const updated = await db
        .update(ticketCrewTable)
        .set({ enRouteRemindSentAt: new Date() })
        .where(and(eq(ticketCrewTable.id, member.crewId), isNull(ticketCrewTable.enRouteRemindSentAt)))
        .returning({ id: ticketCrewTable.id });
      if (updated.length === 0) continue;

      const title = `Looks like you're at ${siteName}`;
      const body = `Tap to check in for ticket #${ticketId}.`;
      try {
        await db.execute(sql`
          INSERT INTO notifications (user_id, type, category, dedupe_key, title, body, link)
          VALUES (
            ${member.userId},
            'late_check_in_nudge',
            'tickets',
            ${`late-checkin-${ticketId}-${member.userId}`},
            ${title},
            ${body},
            ${`/tickets/${ticketId}`}
          )
          ON CONFLICT DO NOTHING
        `);
      } catch (err) {
        logger.warn({ err, ticketId, userId: member.userId }, "late nudge insert failed");
      }
      void fanOutPushToUser(member.userId, {
        type: "late_check_in_nudge",
        title,
        body,
        link: `/tickets/${ticketId}`,
        category: "crew",
        pushData: { ticketId, type: "late_check_in_nudge" },
      }).catch(() => undefined);
      anyNudged = true;
    }

    if (anyNudged) {
      await db
        .update(ticketsTable)
        .set({ lateCheckInReminderSentAt: new Date() })
        .where(eq(ticketsTable.id, ticketId));
    }
  }
}

export function startScheduledNotificationWorker(intervalMs = 60_000): void {
  if (workerTimer) return;
  const tick = () => {
    dispatchDueNotifications().catch((err) => logger.warn({ err }, "scheduled notif worker tick failed"));
    dispatchLateCheckInNudges().catch((err) => logger.warn({ err }, "late check-in nudge tick failed"));
  };
  workerTimer = setInterval(tick, intervalMs);
  // Run once immediately so any rows already past due fire promptly on boot.
  setTimeout(tick, 1_000).unref?.();
}

export function stopScheduledNotificationWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
