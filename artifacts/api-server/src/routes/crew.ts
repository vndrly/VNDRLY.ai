import { Router, type IRouter } from "express";
import { eq, and, isNull, desc, inArray, sql } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  ticketsTable,
  ticketCheckInsTable,
  vendorPeopleTable,
  ticketLineItemsTable,
  siteLocationsTable,
  vendorsTable,
  ticketAssignmentRatesTable,
  ticketCrewTable,
} from "@workspace/db";
import { formatTicketTrackingNumber } from "@workspace/db/format";

import { SESSION_SECRET } from "../lib/session";
import { logger } from "../lib/logger";
import { regenerateAutoLaborLines } from "../lib/auto-labor-lines";
import { notifyUsers } from "./notifications";

const COOKIE_NAME = "vndrly_session";
type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null };

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

const DEFAULT_DAILY_OT_HOURS = 8;
const DEFAULT_WEEKLY_OT_HOURS = 40;

const router: IRouter = Router();

async function loadTicketForAuth(ticketId: number) {
  const [t] = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      status: ticketsTable.status,
      partnerId: siteLocationsTable.partnerId,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      foremanUserId: ticketsTable.foremanUserId,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, ticketId));
  return t || null;
}

// Read access: admin, partner of the site, vendor matching the ticket, or
// field employee within that vendor. Returns true if allowed (and writes
// 401/403/404 to res otherwise).
async function ensureCrewRead(req: any, res: any, ticketId: number): Promise<boolean> {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" }); return false; }
  const ticket = await loadTicketForAuth(ticketId);
  if (!ticket) { res.status(404).json({ error: "Ticket not found", code: "ticket.not_found" }); return false; }
  if (session.role === "admin") return true;
  if (session.role === "vendor" && session.vendorId === ticket.vendorId) return true;
  if (session.role === "partner" && session.partnerId === ticket.partnerId) return true;
  if (session.role === "field_employee") {
    const [me] = await db
      .select({ vendorId: vendorPeopleTable.vendorId })
      .from(vendorPeopleTable)
      .where(and(eq(vendorPeopleTable.userId, session.userId), isNull(vendorPeopleTable.deletedAt)));
    if (me && me.vendorId === ticket.vendorId) return true;
  }
  res.status(403).json({ error: "Not allowed", code: "ticket.no_access" });
  return false;
}

async function loadEmployeeForAuth(employeeId: number) {
  const [e] = await db
    .select({
      id: vendorPeopleTable.id,
      vendorId: vendorPeopleTable.vendorId,
      vendorRole: vendorPeopleTable.vendorRole,
      hourlyRate: vendorPeopleTable.hourlyRate,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      userId: vendorPeopleTable.userId,
      // Task #524: surface isActive so crew check-in / roster-add can
      // reject workers the office deactivated mid-shift with a clear
      // structured code, instead of silently writing a session for a
      // worker the mobile picker would no longer offer.
      isActive: vendorPeopleTable.isActive,
    })
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.id, employeeId), isNull(vendorPeopleTable.deletedAt)));
  return e || null;
}

// Allowed if admin, or vendor user matching the ticket's vendor, or
// field_employee belonging to the same vendor.
const MUTABLE_TICKET_STATUSES = new Set(["initiated", "draft", "in_progress", "kicked_back"]);

async function ensureCrewMutate(req: any, res: any, ticketId: number): Promise<{ session: Session | null; vendorId: number } | null> {
  const session = getSession(req);
  const ticket = await loadTicketForAuth(ticketId);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found", code: "ticket.not_found" });
    return null;
  }
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return null;
  }
  if (!MUTABLE_TICKET_STATUSES.has(ticket.status)) {
    res.status(409).json({
      error: `Ticket is ${ticket.status.replace(/_/g, " ")} and can no longer be edited`,
      code: "ticket.not_editable",
    });
    return null;
  }
  if (session.role === "admin") return { session, vendorId: ticket.vendorId };
  if (session.role === "vendor" && session.vendorId === ticket.vendorId) {
    return { session, vendorId: ticket.vendorId };
  }
  if (session.role === "field_employee") {
    // Foreman-scoped: only field employees with vendorRole 'foreman' or 'both'
    // can mutate crew records on behalf of others. Plain field employees can
    // still self check-in/out via the legacy /tickets/:id/check-in route.
    const [me] = await db
      .select({ vendorId: vendorPeopleTable.vendorId, vendorRole: vendorPeopleTable.vendorRole })
      .from(vendorPeopleTable)
      .where(and(eq(vendorPeopleTable.userId, session.userId), isNull(vendorPeopleTable.deletedAt)));
    if (me && me.vendorId === ticket.vendorId && (me.vendorRole === "foreman" || me.vendorRole === "both")) {
      return { session, vendorId: ticket.vendorId };
    }
  }
  res.status(403).json({ error: "Not allowed", code: "ticket.no_access" });
  return null;
}

// POST /tickets/:id/crew/:employeeId/check-in
router.post("/tickets/:id/crew/:employeeId/check-in", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  const employeeId = Number(req.params.employeeId);
  if (!Number.isFinite(ticketId) || !Number.isFinite(employeeId)) {
    res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
    return;
  }
  const auth = await ensureCrewMutate(req, res, ticketId);
  if (!auth) return;
  const employee = await loadEmployeeForAuth(employeeId);
  if (!employee) {
    res.status(404).json({ error: "Employee not found", code: "employee.not_found" });
    return;
  }
  if (employee.vendorId !== auth.vendorId) {
    res.status(403).json({ error: "Employee is not part of this ticket's vendor", code: "employee.vendor_mismatch" });
    return;
  }
  // Task #524: refuse to start a new check-in session for a worker the
  // office deactivated. The mobile picker drops inactive workers on its
  // own refresh cadence (Task #524 mobile change), but a foreman who
  // tapped the row before the next refresh would otherwise create a
  // session for someone who can no longer log into the app. Check-out
  // is intentionally NOT gated here so a worker who was open at the
  // time of deactivation can still be cleanly closed out.
  if (employee.isActive === false) {
    res.status(409).json({
      error: "That crew member is no longer active",
      code: "crew.employee_inactive",
    });
    return;
  }

  // Refuse if there's already an open session for this employee on this ticket.
  const [open] = await db
    .select({ id: ticketCheckInsTable.id })
    .from(ticketCheckInsTable)
    .where(and(
      eq(ticketCheckInsTable.ticketId, ticketId),
      eq(ticketCheckInsTable.employeeId, employeeId),
      isNull(ticketCheckInsTable.checkOutAt),
    ));
  if (open) {
    res.status(409).json({ error: "Employee is already checked in to this ticket", code: "crew.already_checked_in" });
    return;
  }

  const lat = typeof req.body?.latitude === "number" ? req.body.latitude : null;
  const lng = typeof req.body?.longitude === "number" ? req.body.longitude : null;
  const overrideRate = typeof req.body?.hourlyRateAtTime === "number" ? String(req.body.hourlyRateAtTime) : null;

  // Resolve effective rate: explicit body override → ticket-assignment override
  // → employee default. This lets foremen pin a per-ticket rate that survives
  // across multiple in/out cycles for the same person.
  let effectiveRate: string | null = overrideRate;
  if (!effectiveRate) {
    const [assigned] = await db
      .select({ hourlyRate: ticketAssignmentRatesTable.hourlyRate })
      .from(ticketAssignmentRatesTable)
      .where(and(
        eq(ticketAssignmentRatesTable.ticketId, ticketId),
        eq(ticketAssignmentRatesTable.employeeId, employeeId),
      ));
    effectiveRate = assigned?.hourlyRate ?? employee.hourlyRate ?? null;
  }

  const checkInAt = new Date();
  const [row] = await db.insert(ticketCheckInsTable).values({
    ticketId,
    employeeId,
    checkInAt,
    checkInLatitude: lat,
    checkInLongitude: lng,
    hourlyRateAtTime: effectiveRate,
    source: "manual",
  }).returning();

  // Backwards compatibility: keep legacy ticket-row check-in fields in sync
  // when this is the ticket's primary field employee.
  const ticketForSync = await loadTicketForAuth(ticketId);
  if (ticketForSync && ticketForSync.fieldEmployeeId === employeeId) {
    await db.update(ticketsTable)
      .set({
        checkInTime: checkInAt,
        checkInLatitude: lat,
        checkInLongitude: lng,
      })
      .where(eq(ticketsTable.id, ticketId));
  }

  res.status(201).json(row);

  // Foreman alert: crew punch in (Option A — foreman-driven or observed)
  try {
    const ticket = await loadTicketForAuth(ticketId);
    const employee = await loadEmployeeForAuth(employeeId);
    if (
      ticket?.foremanUserId &&
      auth.session?.userId !== ticket.foremanUserId &&
      employee
    ) {
      const name = `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim() || "Crew member";
      await notifyUsers([ticket.foremanUserId], {
        type: "crew_punch_in",
        title: `${name} checked in`,
        body: `Ticket ${formatTicketTrackingNumber(ticketId)}`,
        link: `/tickets/${ticketId}`,
        dedupeKey: `crew_punch_in:${row.id}`,
        category: "crew",
        pushData: { ticketId, type: "crew_punch_in" },
      });
    }
  } catch (err) {
    logger.warn({ err, ticketId, employeeId }, "foreman crew punch-in notification failed");
  }
});

// POST /tickets/:id/crew/:employeeId/check-out
router.post("/tickets/:id/crew/:employeeId/check-out", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  const employeeId = Number(req.params.employeeId);
  if (!Number.isFinite(ticketId) || !Number.isFinite(employeeId)) {
    res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
    return;
  }
  const auth = await ensureCrewMutate(req, res, ticketId);
  if (!auth) return;

  const [open] = await db
    .select({ id: ticketCheckInsTable.id })
    .from(ticketCheckInsTable)
    .where(and(
      eq(ticketCheckInsTable.ticketId, ticketId),
      eq(ticketCheckInsTable.employeeId, employeeId),
      isNull(ticketCheckInsTable.checkOutAt),
    ));
  if (!open) {
    res.status(404).json({ error: "No open check-in found for this employee", code: "crew.no_open_check_in" });
    return;
  }

  const lat = typeof req.body?.latitude === "number" ? req.body.latitude : null;
  const lng = typeof req.body?.longitude === "number" ? req.body.longitude : null;

  const checkOutAt = new Date();
  const [row] = await db.update(ticketCheckInsTable)
    .set({ checkOutAt, checkOutLatitude: lat, checkOutLongitude: lng })
    .where(eq(ticketCheckInsTable.id, open.id))
    .returning();

  // Backwards compatibility: mirror to legacy ticket-row fields when this is
  // the ticket's primary field employee.
  const ticketForSync = await loadTicketForAuth(ticketId);
  if (ticketForSync && ticketForSync.fieldEmployeeId === employeeId) {
    await db.update(ticketsTable)
      .set({
        checkOutTime: checkOutAt,
        checkOutLatitude: lat,
        checkOutLongitude: lng,
      })
      .where(eq(ticketsTable.id, ticketId));
  }

  // Refresh the per-employee running [auto] labor lines so the foreman
  // and HQ see the new total the moment a crew member punches out. The
  // helper is a no-op once the ticket is closed.
  try {
    await regenerateAutoLaborLines(ticketId);
  } catch (err) {
    logger.error({ err, ticketId, employeeId }, "regenerate auto labor lines failed (crew check-out)");
  }

  res.json(row);

  try {
    const ticket = await loadTicketForAuth(ticketId);
    const employee = await loadEmployeeForAuth(employeeId);
    if (
      ticket?.foremanUserId &&
      auth.session?.userId !== ticket.foremanUserId &&
      employee
    ) {
      const name = `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim() || "Crew member";
      await notifyUsers([ticket.foremanUserId], {
        type: "crew_punch_out",
        title: `${name} checked out`,
        body: `Ticket ${formatTicketTrackingNumber(ticketId)}`,
        link: `/tickets/${ticketId}`,
        dedupeKey: `crew_punch_out:${row.id}`,
        category: "crew",
        pushData: { ticketId, type: "crew_punch_out" },
      });
    }
  } catch (err) {
    logger.warn({ err, ticketId, employeeId }, "foreman crew punch-out notification failed");
  }
});

// PATCH /tickets/:id/crew-sessions/:sessionId — supervisor correction
router.patch("/tickets/:id/crew-sessions/:sessionId", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  if (!Number.isFinite(ticketId) || !Number.isFinite(sessionId)) {
    res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
    return;
  }
  const auth = await ensureCrewMutate(req, res, ticketId);
  if (!auth) return;
  // ensureCrewMutate already restricts field_employee to those with vendorRole
  // foreman/both, which matches the supervisor-correction policy. Vendor and
  // admin remain allowed.

  const [existing] = await db
    .select()
    .from(ticketCheckInsTable)
    .where(and(eq(ticketCheckInsTable.id, sessionId), eq(ticketCheckInsTable.ticketId, ticketId)));
  if (!existing) {
    res.status(404).json({ error: "Session not found", code: "crew.session_not_found" });
    return;
  }

  const update: Partial<typeof ticketCheckInsTable.$inferInsert> = {
    source: "corrected",
    correctedById: auth.session?.userId ?? null,
  };
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    res.status(400).json({ error: "reason is required", code: "crew.reason_required" });
    return;
  }
  update.correctedReason = reason;
  if (req.body?.checkInAt !== undefined) update.checkInAt = req.body.checkInAt ? new Date(req.body.checkInAt) : existing.checkInAt;
  if (req.body?.checkOutAt !== undefined) update.checkOutAt = req.body.checkOutAt ? new Date(req.body.checkOutAt) : null;
  if (typeof req.body?.hourlyRateAtTime === "number") update.hourlyRateAtTime = String(req.body.hourlyRateAtTime);

  const [row] = await db.update(ticketCheckInsTable)
    .set(update)
    .where(eq(ticketCheckInsTable.id, sessionId))
    .returning();

  // Office-side correction (e.g. closing out an employee who forgot to
  // check out, fixing a typo'd start time, swapping the rate-at-time)
  // shifts the running totals — refresh the [auto] labor lines so the
  // foreman immediately sees the corrected per-employee running total.
  try {
    await regenerateAutoLaborLines(ticketId);
  } catch (err) {
    logger.error({ err, ticketId, sessionId }, "regenerate auto labor lines failed (crew session correction)");
  }

  res.json(row);
});

// POST /tickets/:id/close — foreman / vendor-admin / org-admin freezes the
// ticket. Runs the final pass of `regenerateAutoLaborLines` so the running
// per-employee totals lock in as the final billable [auto] rows, then
// stamps `closedAt` + `closedById`. After this the regen helper short-
// circuits, so accounting can edit the rows by hand without them being
// overwritten by stray late check-out events.
// Statuses where closing is meaningless: ticket is either pre-handshake
// (vendor hasn't accepted yet) or already past the foreman's authority
// (back-office accounting / payment-side has taken over). We DO allow
// closing in `pending_review` and `kicked_back` because that's the
// realistic state the ticket sits in once everyone has clocked out and
// the foreman is wrapping up — the existing MUTABLE_TICKET_STATUSES
// gate (initiated/draft/in_progress/kicked_back) used by per-employee
// check-in is too narrow for closing, so we run our own status check
// here instead of going through ensureCrewMutate.
const CLOSE_TICKET_REFUSE_STATUSES = new Set([
  "awaiting_acceptance",
  "denied",
  "cancelled",
  "approved",
  "completed",
  "funds_dispersed",
  "submitted",
]);

router.post("/tickets/:id/close", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
    return;
  }

  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }

  const [existing] = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      status: ticketsTable.status,
      closedAt: ticketsTable.closedAt,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!existing) {
    res.status(404).json({ error: "Ticket not found", code: "ticket.not_found" });
    return;
  }
  if (existing.closedAt) {
    res.status(409).json({
      error: "Ticket already closed",
      code: "ticket.already_closed",
      closedAt: existing.closedAt,
    });
    return;
  }
  if (CLOSE_TICKET_REFUSE_STATUSES.has(existing.status)) {
    res.status(409).json({
      error: `Ticket is ${existing.status.replace(/_/g, " ")} and cannot be closed`,
      code: "ticket.not_closeable",
    });
    return;
  }

  // Same actor set as ensureCrewMutate — admin (org-admin), vendor user
  // matching the ticket (vendor-admin), or field_employee with
  // vendorRole 'foreman'/'both' (foreman). Inlined here because we
  // intentionally skip ensureCrewMutate's MUTABLE_TICKET_STATUSES gate.
  let allowed = false;
  if (session.role === "admin") {
    allowed = true;
  } else if (session.role === "vendor" && session.vendorId === existing.vendorId) {
    allowed = true;
  } else if (session.role === "field_employee") {
    const [me] = await db
      .select({ vendorId: vendorPeopleTable.vendorId, vendorRole: vendorPeopleTable.vendorRole })
      .from(vendorPeopleTable)
      .where(and(eq(vendorPeopleTable.userId, session.userId), isNull(vendorPeopleTable.deletedAt)));
    if (me && me.vendorId === existing.vendorId && (me.vendorRole === "foreman" || me.vendorRole === "both")) {
      allowed = true;
    }
  }
  if (!allowed) {
    res.status(403).json({ error: "Not allowed", code: "ticket.no_access" });
    return;
  }

  // Final regen BEFORE stamping closedAt so the helper still runs (the
  // short-circuit guard would otherwise return 0 immediately). If the
  // regen fails we bail out and leave the ticket open — re-trying close
  // is safe and keeps us out of the half-frozen state where closedAt is
  // set but the lines weren't refreshed.
  try {
    await regenerateAutoLaborLines(ticketId);
  } catch (err) {
    logger.error({ err, ticketId }, "final regenerate auto labor lines failed (close) — refusing to close");
    res.status(500).json({ error: "Could not finalize labor totals", code: "ticket.close_regen_failed" });
    return;
  }

  const closedAt = new Date();
  const [row] = await db.update(ticketsTable)
    .set({
      closedAt,
      closedById: session.userId,
    })
    .where(eq(ticketsTable.id, ticketId))
    .returning({
      id: ticketsTable.id,
      closedAt: ticketsTable.closedAt,
      closedById: ticketsTable.closedById,
    });

  res.json(row);
});

// GET /tickets/:id/crew-roster
// Lightweight roster of who is currently on site for a ticket. Distinct from
// crew-sessions (which tracks individual check-in/out events) — the roster is
// a manual list maintained by a foreman / vendor admin for crews that don't
// punch in and out individually.
router.get("/tickets/:id/crew-roster", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  if (!(await ensureCrewRead(req, res, ticketId))) return;

  const rows = await db
    .select({
      id: ticketCrewTable.id,
      ticketId: ticketCrewTable.ticketId,
      employeeId: ticketCrewTable.employeeId,
      employeeName: sql<string>`${vendorPeopleTable.firstName} || ' ' || ${vendorPeopleTable.lastName}`,
      vendorRole: vendorPeopleTable.vendorRole,
      addedAt: ticketCrewTable.addedAt,
      addedByUserId: ticketCrewTable.addedByUserId,
    })
    .from(ticketCrewTable)
    .leftJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
    .where(and(
      eq(ticketCrewTable.ticketId, ticketId),
      isNull(ticketCrewTable.removedAt),
    ))
    .orderBy(ticketCrewTable.addedAt);
  res.json(rows);
});

// POST /tickets/:id/crew-roster — body: { employeeId }
router.post("/tickets/:id/crew-roster", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const employeeId = Number(req.body?.employeeId);
  if (!Number.isFinite(employeeId)) { res.status(400).json({ error: "Invalid employeeId", code: "validation.invalid_employee_id" }); return; }

  const auth = await ensureCrewMutate(req, res, ticketId);
  if (!auth) return;

  const employee = await loadEmployeeForAuth(employeeId);
  if (!employee) { res.status(404).json({ error: "Employee not found", code: "employee.not_found" }); return; }
  if (employee.vendorId !== auth.vendorId) {
    res.status(403).json({ error: "Employee is not part of this ticket's vendor", code: "employee.vendor_mismatch" });
    return;
  }
  // Task #524: refuse to add a deactivated worker to the on-site roster.
  // Mirrors the check-in guard above — the mobile picker now refreshes
  // on the same 60s sync tick used for crew-sessions, but a foreman
  // who tapped a row in the picker before the next refresh would
  // otherwise stamp a deactivated worker onto the roster.
  if (employee.isActive === false) {
    res.status(409).json({
      error: "That crew member is no longer active",
      code: "crew.employee_inactive",
    });
    return;
  }

  // Refuse if already on the active roster.
  const [existing] = await db
    .select({ id: ticketCrewTable.id })
    .from(ticketCrewTable)
    .where(and(
      eq(ticketCrewTable.ticketId, ticketId),
      eq(ticketCrewTable.employeeId, employeeId),
      isNull(ticketCrewTable.removedAt),
    ));
  if (existing) {
    res.status(409).json({ error: "Employee is already on the crew roster for this ticket", code: "crew.already_on_roster" });
    return;
  }

  let row;
  try {
    [row] = await db
      .insert(ticketCrewTable)
      .values({
        ticketId,
        employeeId,
        addedByUserId: auth.session?.userId ?? null,
      })
      .returning();
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      res.status(409).json({ error: "Employee is already on the crew roster for this ticket", code: "crew.already_on_roster" });
      return;
    }
    throw err;
  }

  // Task #625 / Task #631: tell the newly added crew member they were
  // just added to a ticket. Mirrors the lead-assignment push (see
  // tickets.ts → "New Tracking Assigned") and the crew_removed push
  // below. The dedupeKey is `(user_id, dedupe_key)`-unique; including
  // the row's `addedAt` ISO timestamp ensures a re-add after a removal
  // still fires (a fresh row has a fresh addedAt), while a duplicate
  // POST that hits the unique-violation path above never reaches this
  // notify call. We deliberately skip the actor's own user id so
  // foremen who add themselves to the roster don't get a "you've been
  // added" push for their own action; the ticket lead also already
  // received `ticket_assigned`, so when the lead is re-added as crew
  // here they only get that one push.
  if (
    employee.userId &&
    employee.userId !== (auth.session?.userId ?? null)
  ) {
    const addedAtIso =
      row.addedAt instanceof Date
        ? row.addedAt.toISOString()
        : new Date(row.addedAt as unknown as string | number).toISOString();
    try {
      await notifyUsers([employee.userId], {
        type: "crew_added",
        title: "You've been added to a ticket",
        body: `Tracking ${formatTicketTrackingNumber(ticketId)} — tap to see the job.`,
        link: `/tickets/${ticketId}`,
        dedupeKey: `crew_added:${ticketId}:${employeeId}:${addedAtIso}`,
        // Mobile deep-link routing reads `data.ticketId`; without this
        // the push opens the app but doesn't navigate to the ticket.
        pushData: { ticketId, type: "crew_added" },
      });
    } catch (err) {
      logger.warn(
        { err, ticketId, employeeId, userId: employee.userId },
        "crew_added notify failed",
      );
    }
  }

  res.status(201).json({
    id: row.id,
    ticketId: row.ticketId,
    employeeId: row.employeeId,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    vendorRole: employee.vendorRole,
    addedAt: row.addedAt,
    addedByUserId: row.addedByUserId,
  });
});

// DELETE /tickets/:id/crew-roster/:employeeId
router.delete("/tickets/:id/crew-roster/:employeeId", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  const employeeId = Number(req.params.employeeId);
  if (!Number.isFinite(ticketId) || !Number.isFinite(employeeId)) {
    res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
    return;
  }
  const auth = await ensureCrewMutate(req, res, ticketId);
  if (!auth) return;

  const now = new Date();
  const result = await db
    .update(ticketCrewTable)
    .set({ removedAt: now, removedByUserId: auth.session?.userId ?? null })
    .where(and(
      eq(ticketCrewTable.ticketId, ticketId),
      eq(ticketCrewTable.employeeId, employeeId),
      isNull(ticketCrewTable.removedAt),
    ))
    .returning({ id: ticketCrewTable.id });
  if (result.length === 0) {
    res.status(404).json({ error: "Crew member not on roster", code: "crew.not_on_roster" });
    return;
  }

  // Tell the removed crew member they're off the ticket. Without this push
  // they keep seeing the ticket on their list until the next refresh and may
  // show up to a job they're no longer on. The dedupe key includes the
  // removal timestamp so a future re-removal (after a re-add) still fires.
  void notifyRemovedCrewMember({ ticketId, employeeId, removedAt: now }).catch(
    () => undefined,
  );

  res.status(204).send();
});

export async function notifyRemovedCrewMember(input: {
  ticketId: number;
  employeeId: number;
  removedAt: Date;
}): Promise<void> {
  const { ticketId, employeeId, removedAt } = input;
  // Resolve the linked user account. Crew members without a login (e.g.
  // sub-contractors entered as people but never invited) silently skip.
  const [person] = await db
    .select({ userId: vendorPeopleTable.userId })
    .from(vendorPeopleTable)
    .where(eq(vendorPeopleTable.id, employeeId));
  const userId = person?.userId;
  if (typeof userId !== "number") return;

  const [ticket] = await db
    .select({
      id: ticketsTable.id,
      siteName: siteLocationsTable.name,
    })
    .from(ticketsTable)
    .leftJoin(
      siteLocationsTable,
      eq(siteLocationsTable.id, ticketsTable.siteLocationId),
    )
    .where(eq(ticketsTable.id, ticketId));
  if (!ticket) return;

  const tracking = formatTicketTrackingNumber(ticket.id);
  const where = ticket.siteName ? ` at ${ticket.siteName}` : "";
  // Deep-link to the tickets list, not the ticket itself: the removed crew
  // member no longer has access and the ticket detail page would 403.
  await notifyUsers([userId], {
    type: "crew_removed",
    title: "Removed from a ticket crew",
    body: `You've been taken off ticket ${tracking}${where}.`,
    link: "/tickets",
    dedupeKey: `crew_removed:${ticketId}:${employeeId}:${removedAt.toISOString()}`,
    pushData: { type: "crew_removed" },
  });
}

// GET /tickets/:id/crew-sessions
router.get("/tickets/:id/crew-sessions", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  if (!(await ensureCrewRead(req, res, ticketId))) return;

  const rows = await db
    .select({
      id: ticketCheckInsTable.id,
      ticketId: ticketCheckInsTable.ticketId,
      employeeId: ticketCheckInsTable.employeeId,
      employeeName: sql<string>`${vendorPeopleTable.firstName} || ' ' || ${vendorPeopleTable.lastName}`,
      checkInAt: ticketCheckInsTable.checkInAt,
      checkOutAt: ticketCheckInsTable.checkOutAt,
      checkInLatitude: ticketCheckInsTable.checkInLatitude,
      checkInLongitude: ticketCheckInsTable.checkInLongitude,
      checkOutLatitude: ticketCheckInsTable.checkOutLatitude,
      checkOutLongitude: ticketCheckInsTable.checkOutLongitude,
      hourlyRateAtTime: ticketCheckInsTable.hourlyRateAtTime,
      source: ticketCheckInsTable.source,
      correctedById: ticketCheckInsTable.correctedById,
      correctedReason: ticketCheckInsTable.correctedReason,
    })
    .from(ticketCheckInsTable)
    .leftJoin(vendorPeopleTable, eq(ticketCheckInsTable.employeeId, vendorPeopleTable.id))
    .where(eq(ticketCheckInsTable.ticketId, ticketId))
    .orderBy(ticketCheckInsTable.checkInAt);
  res.json(rows);
});

type LaborSession = {
  id: number;
  employeeId: number;
  employeeName: string;
  checkInAt: string;
  checkOutAt: string | null;
  hours: number;
  rate: number;
  cost: number;
  isOpen: boolean;
  longSession: boolean;
  source: string;
};

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
}

function splitByUtcDay(start: Date, end: Date): Array<{ start: Date; end: Date }> {
  if (end <= start) return [];
  const out: Array<{ start: Date; end: Date }> = [];
  let cur = start;
  while (cur < end) {
    const nextDay = new Date(Date.UTC(
      cur.getUTCFullYear(),
      cur.getUTCMonth(),
      cur.getUTCDate() + 1,
      0, 0, 0, 0,
    ));
    const sliceEnd = nextDay < end ? nextDay : end;
    out.push({ start: cur, end: sliceEnd });
    cur = sliceEnd;
  }
  return out;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoWeekKey(d: Date): string {
  // simple year-week key
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const diff = (t.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// GET /tickets/:id/labor-summary
router.get("/tickets/:id/labor-summary", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  if (!(await ensureCrewRead(req, res, ticketId))) return;

  // Resolve OT thresholds: explicit query override → vendor config → system defaults.
  const ticket = await loadTicketForAuth(ticketId);
  let vendorDailyOt: number | null = null;
  let vendorWeeklyOt: number | null = null;
  if (ticket?.vendorId) {
    const [v] = await db
      .select({ dailyOt: vendorsTable.dailyOtHours, weeklyOt: vendorsTable.weeklyOtHours })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, ticket.vendorId));
    if (v) {
      vendorDailyOt = v.dailyOt != null ? parseFloat(v.dailyOt) : null;
      vendorWeeklyOt = v.weeklyOt != null ? parseFloat(v.weeklyOt) : null;
    }
  }
  const dailyOt = Number(req.query.dailyOtHours) || vendorDailyOt || DEFAULT_DAILY_OT_HOURS;
  const weeklyOt = Number(req.query.weeklyOtHours) || vendorWeeklyOt || DEFAULT_WEEKLY_OT_HOURS;
  const longSessionThreshold = 8;

  const sessions = await db
    .select({
      id: ticketCheckInsTable.id,
      employeeId: ticketCheckInsTable.employeeId,
      employeeName: sql<string>`${vendorPeopleTable.firstName} || ' ' || ${vendorPeopleTable.lastName}`,
      defaultRate: vendorPeopleTable.hourlyRate,
      checkInAt: ticketCheckInsTable.checkInAt,
      checkOutAt: ticketCheckInsTable.checkOutAt,
      hourlyRateAtTime: ticketCheckInsTable.hourlyRateAtTime,
      source: ticketCheckInsTable.source,
    })
    .from(ticketCheckInsTable)
    .leftJoin(vendorPeopleTable, eq(ticketCheckInsTable.employeeId, vendorPeopleTable.id))
    .where(eq(ticketCheckInsTable.ticketId, ticketId))
    .orderBy(ticketCheckInsTable.checkInAt);

  const now = new Date();
  // Per-person aggregation with OT split
  type PersonAgg = {
    employeeId: number;
    employeeName: string;
    sessions: LaborSession[];
    rate: number;
    regularHours: number;
    overtimeHours: number;
    totalHours: number;
    regularCost: number;
    overtimeCost: number;
    totalCost: number;
  };
  const byPerson = new Map<number, PersonAgg>();

  // Track per-day and per-week totals to attribute OT
  type Buckets = Map<string, number>;
  const dayBuckets = new Map<number, Buckets>();
  const weekBuckets = new Map<number, Buckets>();

  for (const s of sessions) {
    const inAt = new Date(s.checkInAt);
    const outAt = s.checkOutAt ? new Date(s.checkOutAt) : now;
    const isOpen = !s.checkOutAt;
    const hours = hoursBetween(inAt, outAt);
    const rateStr = s.hourlyRateAtTime ?? s.defaultRate ?? "0";
    const rate = parseFloat(rateStr);
    const cost = hours * rate;
    const longSession = hours > longSessionThreshold;

    let agg = byPerson.get(s.employeeId);
    if (!agg) {
      agg = {
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        sessions: [],
        rate,
        regularHours: 0,
        overtimeHours: 0,
        totalHours: 0,
        regularCost: 0,
        overtimeCost: 0,
        totalCost: 0,
      };
      byPerson.set(s.employeeId, agg);
    }
    agg.sessions.push({
      id: s.id,
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      checkInAt: inAt.toISOString(),
      checkOutAt: s.checkOutAt ? new Date(s.checkOutAt).toISOString() : null,
      hours: Math.round(hours * 100) / 100,
      rate,
      cost: Math.round(cost * 100) / 100,
      isOpen,
      longSession,
      source: s.source,
    });

    // OT attribution: split session across UTC day boundaries so chunks
    // crossing midnight are bucketed into the correct day/week.
    let dayB = dayBuckets.get(s.employeeId);
    if (!dayB) { dayB = new Map(); dayBuckets.set(s.employeeId, dayB); }
    let weekB = weekBuckets.get(s.employeeId);
    if (!weekB) { weekB = new Map(); weekBuckets.set(s.employeeId, weekB); }

    let sessionOtHours = 0;
    for (const chunk of splitByUtcDay(inAt, outAt)) {
      const cHours = hoursBetween(chunk.start, chunk.end);
      if (cHours <= 0) continue;
      const dKey = dayKey(chunk.start);
      const wKey = isoWeekKey(chunk.start);
      const priorDay = dayB.get(dKey) ?? 0;
      const priorWeek = weekB.get(wKey) ?? 0;

      const dayOver = Math.max(0, priorDay + cHours - dailyOt);
      const dayWasOver = Math.max(0, priorDay - dailyOt);
      const dailyOtPortion = Math.max(0, dayOver - dayWasOver);

      const weekOver = Math.max(0, priorWeek + cHours - weeklyOt);
      const weekWasOver = Math.max(0, priorWeek - weeklyOt);
      const weeklyOtPortion = Math.max(0, weekOver - weekWasOver);

      sessionOtHours += Math.min(cHours, Math.max(dailyOtPortion, weeklyOtPortion));
      dayB.set(dKey, priorDay + cHours);
      weekB.set(wKey, priorWeek + cHours);
    }

    const otHours = Math.min(hours, sessionOtHours);
    const regHours = hours - otHours;
    agg.regularHours += regHours;
    agg.overtimeHours += otHours;
    agg.totalHours += hours;
    agg.regularCost += regHours * rate;
    agg.overtimeCost += otHours * rate * 1.5;
    agg.totalCost += regHours * rate + otHours * rate * 1.5;
  }

  const people = Array.from(byPerson.values()).map(p => ({
    ...p,
    regularHours: Math.round(p.regularHours * 100) / 100,
    overtimeHours: Math.round(p.overtimeHours * 100) / 100,
    totalHours: Math.round(p.totalHours * 100) / 100,
    regularCost: Math.round(p.regularCost * 100) / 100,
    overtimeCost: Math.round(p.overtimeCost * 100) / 100,
    totalCost: Math.round(p.totalCost * 100) / 100,
  }));

  const totals = people.reduce(
    (acc, p) => ({
      regularHours: acc.regularHours + p.regularHours,
      overtimeHours: acc.overtimeHours + p.overtimeHours,
      totalHours: acc.totalHours + p.totalHours,
      regularCost: acc.regularCost + p.regularCost,
      overtimeCost: acc.overtimeCost + p.overtimeCost,
      totalCost: acc.totalCost + p.totalCost,
    }),
    { regularHours: 0, overtimeHours: 0, totalHours: 0, regularCost: 0, overtimeCost: 0, totalCost: 0 },
  );

  res.json({
    ticketId,
    dailyOtHours: dailyOt,
    weeklyOtHours: weeklyOt,
    longSessionHours: longSessionThreshold,
    people,
    totals: {
      regularHours: Math.round(totals.regularHours * 100) / 100,
      overtimeHours: Math.round(totals.overtimeHours * 100) / 100,
      totalHours: Math.round(totals.totalHours * 100) / 100,
      regularCost: Math.round(totals.regularCost * 100) / 100,
      overtimeCost: Math.round(totals.overtimeCost * 100) / 100,
      totalCost: Math.round(totals.totalCost * 100) / 100,
    },
  });
});

// POST /tickets/:id/generate-labor-line-items
// Replaces previously auto-generated labor rows (description starts with "[auto]")
// while preserving manually created labor lines.
router.post("/tickets/:id/generate-labor-line-items", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const auth = await ensureCrewMutate(req, res, ticketId);
  if (!auth) return;
  const created = await regenerateAutoLaborLines(ticketId);
  res.json({ created });
});

// GET /tickets/:id/assignment-rates — list per-employee ticket rate overrides
router.get("/tickets/:id/assignment-rates", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  if (!(await ensureCrewRead(req, res, ticketId))) return;
  const rows = await db
    .select()
    .from(ticketAssignmentRatesTable)
    .where(eq(ticketAssignmentRatesTable.ticketId, ticketId));
  res.json(rows);
});

// PUT /tickets/:id/assignment-rates/:employeeId — set/clear ticket-assignment rate
router.put("/tickets/:id/assignment-rates/:employeeId", async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  const employeeId = Number(req.params.employeeId);
  if (!Number.isFinite(ticketId) || !Number.isFinite(employeeId)) {
    res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return;
  }
  const auth = await ensureCrewMutate(req, res, ticketId);
  if (!auth) return;
  if (auth.session?.role === "field_employee") {
    res.status(403).json({ error: "Only vendor or admin can set assignment rates", code: "crew.assignment_rate_role" });
    return;
  }
  const rate = req.body?.hourlyRate;
  if (rate === null) {
    await db.delete(ticketAssignmentRatesTable).where(and(
      eq(ticketAssignmentRatesTable.ticketId, ticketId),
      eq(ticketAssignmentRatesTable.employeeId, employeeId),
    ));
    res.json({ deleted: true });
    return;
  }
  const num = Number(rate);
  if (!Number.isFinite(num) || num < 0) {
    res.status(400).json({ error: "hourlyRate must be a non-negative number, or null to clear", code: "crew.invalid_hourly_rate" });
    return;
  }
  const value = String(num);
  const [existing] = await db
    .select({ id: ticketAssignmentRatesTable.id })
    .from(ticketAssignmentRatesTable)
    .where(and(
      eq(ticketAssignmentRatesTable.ticketId, ticketId),
      eq(ticketAssignmentRatesTable.employeeId, employeeId),
    ));
  if (existing) {
    const [row] = await db.update(ticketAssignmentRatesTable)
      .set({ hourlyRate: value, updatedAt: new Date(), setById: auth.session?.userId ?? null })
      .where(eq(ticketAssignmentRatesTable.id, existing.id))
      .returning();
    res.json(row);
  } else {
    const [row] = await db.insert(ticketAssignmentRatesTable).values({
      ticketId,
      employeeId,
      hourlyRate: value,
      setById: auth.session?.userId ?? null,
    }).returning();
    res.status(201).json(row);
  }
});

export default router;
