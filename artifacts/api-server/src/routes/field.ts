import { Router, type IRouter } from "express";
import { eq, and, desc, gte, lte, inArray, ne, or, sql, isNull, isNotNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  db,
  vendorPeopleTable,
  vendorsTable,
  siteLocationsTable,
  partnersTable,
  siteWorkAssignmentsTable,
  workTypesTable,
  ticketsTable,
  usersTable,
  userOrgMembershipsTable,
  gpsLogsTable,
  fieldPushTokensTable,
  ticketCheckInsTable,
  ticketCrewTable,
  vendorCrewPresetsTable,
} from "@workspace/db";
import { sendPushToFieldEmployee } from "../lib/expo-push";
import { notifyUsers } from "./notifications";
import { removeMembership } from "../lib/membership-sync";
import { recordTicketTransition } from "../lib/ticket-transitions";
import { isGeofenceBypassActive } from "../lib/geo";
import { unreadTicketCommentCountSql } from "../lib/unread-comments";
import { enforceTicketsRateLimit } from "../lib/tickets-rate-limit";

import { SESSION_SECRET } from "../lib/session";

const COOKIE_NAME = "vndrly_session";

type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null; displayName?: string; vendorRole?: string | null };

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
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (!obj || typeof obj.exp !== "number" || obj.exp < now) return null;
    return obj;
  } catch {
    return null;
  }
}

function normalizeLanguage(value: unknown): "en" | "es" | "pt" | null {
  if (value === "en" || value === "es" || value === "pt") return value;
  return null;
}

/**
 * Ensure a `user_org_memberships` row exists linking the given user to
 * the given vendor as a field employee, and that the user's
 * `activeMembershipId` points at it.
 *
 * Called from the user-creation paths (`POST /field-employees/:id/login`
 * and `POST /field-employees/bulk-login`) so the membership row is
 * inserted in the same transaction as the user row — eliminating the
 * "user without membership" window that the boot-time backfill used to
 * cover. Idempotent for existing users via `onConflictDoNothing` on
 * (user_id, vendor_id).
 */
async function ensureFieldEmployeeMembershipTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: number,
  vendorId: number,
  vendorPeopleId: number,
): Promise<void> {
  const inserted = await tx
    .insert(userOrgMembershipsTable)
    .values({
      userId,
      orgType: "vendor",
      partnerId: null,
      vendorId,
      role: "field_employee",
      vendorPeopleId,
    })
    .onConflictDoNothing()
    .returning({ id: userOrgMembershipsTable.id });

  let membershipId: number | null = inserted[0]?.id ?? null;
  if (!membershipId) {
    const [existing] = await tx
      .select({ id: userOrgMembershipsTable.id })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.userId, userId),
          eq(userOrgMembershipsTable.vendorId, vendorId),
        ),
      )
      .limit(1);
    membershipId = existing?.id ?? null;
    // Heal a pre-existing membership that's missing the vendor_people
    // link (e.g. created by an earlier code path before this helper
    // started writing it). Mirrors the heal step in the boot backfill.
    if (membershipId) {
      await tx
        .update(userOrgMembershipsTable)
        .set({ vendorPeopleId, role: "field_employee" })
        .where(eq(userOrgMembershipsTable.id, membershipId));
    }
  }

  if (membershipId) {
    await tx
      .update(usersTable)
      .set({ activeMembershipId: membershipId })
      .where(eq(usersTable.id, userId));
  }
}

async function requireFieldUser(req: any, res: any) {
  const session = getSession(req);
  if (!session || session.role !== "field_employee") {
    res.status(401).json({
      code: "field.login_required",
      error: "field_login_required",
      message: "Field employee login required",
    });
    return null;
  }
  const [fe] = await db
    .select({
      id: vendorPeopleTable.id,
      vendorId: vendorPeopleTable.vendorId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      email: vendorPeopleTable.email,
      isActive: vendorPeopleTable.isActive,
      hourlyRate: vendorPeopleTable.hourlyRate,
      vendorName: vendorsTable.name,
    })
    .from(vendorPeopleTable)
    .leftJoin(vendorsTable, eq(vendorPeopleTable.vendorId, vendorsTable.id))
    .where(eq(vendorPeopleTable.userId, session.userId));
  if (!fe || !fe.isActive) {
    res.status(403).json({ message: "Field account not active", code: "field.account_inactive" });
    return null;
  }
  return { session, employee: fe };
}

async function requireForemanFieldUser(req: any, res: any) {
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return null;
  const role = ctx.session.vendorRole;
  if (role !== "foreman" && role !== "both") {
    res.status(403).json({
      code: "foreman.required",
      error: "foreman_required",
      message: "Foreman access required",
    });
    return null;
  }
  return ctx;
}

function parseEmployeeIdList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Field-employee OR vendor-admin gate.
 *
 * Some "field" endpoints (open-tickets list/detail and `/field/me`) are
 * useful read-only for a vendor admin who wants to see all open tickets
 * across their team from the iOS app. We accept both roles here and
 * return a discriminated union so callers can branch on `mode`:
 *
 *   - `field`  — full field-employee context (vendorPeople row, etc.)
 *   - `vendor` — minimal vendor context (vendorId + vendorName); no
 *                vendor_people row exists for an office-side admin.
 *
 * Anything else (admin, partner, no session) gets a 401.
 */
async function requireFieldOrVendor(req: any, res: any): Promise<
  | {
      mode: "field";
      session: Session;
      vendorId: number;
      vendorName: string | null;
      employee: NonNullable<Awaited<ReturnType<typeof requireFieldUser>>>["employee"];
    }
  | {
      mode: "vendor";
      session: Session;
      vendorId: number;
      vendorName: string | null;
    }
  | null
> {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      code: "auth.required",
      error: "login_required",
      message: "Login required",
    });
    return null;
  }

  if (session.role === "field_employee") {
    const ctx = await requireFieldUser(req, res);
    if (!ctx) return null;
    return {
      mode: "field",
      session: ctx.session,
      vendorId: ctx.employee.vendorId,
      vendorName: ctx.employee.vendorName,
      employee: ctx.employee,
    };
  }

  if (session.role === "vendor" && session.vendorId != null) {
    const [vendor] = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, session.vendorId));
    if (!vendor) {
      res.status(403).json({
        code: "field.vendor_not_found",
        error: "field_vendor_not_found",
        message: "Vendor not found",
      });
      return null;
    }
    return {
      mode: "vendor",
      session,
      vendorId: vendor.id,
      vendorName: vendor.name ?? null,
    };
  }

  res.status(401).json({
    code: "field.field_or_vendor_login_required",
    error: "field_or_vendor_login_required",
    message: "Field employee or vendor login required",
  });
  return null;
}

const router: IRouter = Router();

// ── GET /api/field/me — current field employee, or vendor admin shape ──
//
// Accepts both field-employee and vendor-admin sessions. For a vendor
// admin (no vendor_people row exists for office-side users), returns a
// minimal payload with `viewerRole: "vendor"`, `vendorId`, and
// `vendorName` so the mobile profile/header can render without 401-ing
// out. All field-employee-specific fields are nulled in vendor mode.
router.get("/field/me", async (req, res): Promise<void> => {
  const ctx = await requireFieldOrVendor(req, res);
  if (!ctx) return;

  if (ctx.mode === "vendor") {
    const [vendor] = await db
      .select({ logoUrl: vendorsTable.logoUrl, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, ctx.vendorId));
    res.json({
      viewerRole: "vendor",
      employeeId: null,
      userId: ctx.session.userId,
      firstName: ctx.session.displayName ?? null,
      lastName: null,
      email: null,
      vendorId: ctx.vendorId,
      vendorName: vendor?.name ?? ctx.vendorName,
      jobTitle: null,
      phone: null,
      pecExpirationDate: null,
      pecCertification: false,
      vendorLogoUrl: vendor?.logoUrl ?? null,
      profilePhotoPath: null,
      photoUrl: null,
    });
    return;
  }

  const [extra] = await db
    .select({
      profilePhotoPath: vendorPeopleTable.profilePhotoPath,
      photoUrl: vendorPeopleTable.photoUrl,
      jobTitle: vendorPeopleTable.jobTitle,
      phone: vendorPeopleTable.phone,
      pecExpirationDate: vendorPeopleTable.pecExpirationDate,
      pecCertification: vendorPeopleTable.pecCertification,
      vendorLogoUrl: vendorsTable.logoUrl,
    })
    .from(vendorPeopleTable)
    .leftJoin(vendorsTable, eq(vendorPeopleTable.vendorId, vendorsTable.id))
    .where(eq(vendorPeopleTable.id, ctx.employee.id));
  res.json({
    viewerRole: "field_employee",
    employeeId: ctx.employee.id,
    // Task #498: the auth user id behind this field employee — needed
    // by the mobile new-ticket adjacent-mode foreman picker so it can
    // tell "self" apart from other foreman-eligible vendor people. The
    // /api/field/foremen list keys off `userId`, so the picker compares
    // foremanUserId selection against this value to render the
    // checkmark on the "self" chip and to suppress a duplicate entry
    // in the rest of the list.
    userId: ctx.session.userId,
    firstName: ctx.employee.firstName,
    lastName: ctx.employee.lastName,
    email: ctx.employee.email,
    vendorId: ctx.employee.vendorId,
    vendorName: ctx.employee.vendorName,
    jobTitle: extra?.jobTitle ?? null,
    phone: extra?.phone ?? null,
    pecExpirationDate: extra?.pecExpirationDate ?? null,
    pecCertification: extra?.pecCertification ?? false,
    vendorLogoUrl: extra?.vendorLogoUrl ?? null,
    profilePhotoPath: extra?.profilePhotoPath ?? null,
    photoUrl: extra?.photoUrl ?? null,
  });
});

// ── PATCH /api/field/me — update current field employee profile ──
router.patch("/field/me", async (req, res): Promise<void> => {
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return;
  const body = (req.body ?? {}) as {
    profilePhotoPath?: string | null;
    firstName?: string;
    lastName?: string;
    jobTitle?: string | null;
    phone?: string | null;
    pecExpirationDate?: string | null;
  };

  const updates: Record<string, unknown> = {};
  if ("profilePhotoPath" in body) updates.profilePhotoPath = body.profilePhotoPath ?? null;
  if (typeof body.firstName === "string") {
    const v = body.firstName.trim();
    if (!v) {
      res.status(400).json({
        code: "field.first_name_required",
        error: "field_first_name_required",
        message: "First name is required",
      });
      return;
    }
    updates.firstName = v;
  }
  if (typeof body.lastName === "string") updates.lastName = body.lastName.trim();
  if ("jobTitle" in body) {
    const v = body.jobTitle == null ? null : String(body.jobTitle).trim() || null;
    updates.jobTitle = v;
  }
  if ("phone" in body) {
    const v = body.phone == null ? null : String(body.phone).trim() || null;
    updates.phone = v;
  }
  if ("pecExpirationDate" in body) {
    const raw = body.pecExpirationDate;
    if (raw == null || raw === "") {
      updates.pecExpirationDate = null;
      updates.pecCertification = false;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        res.status(400).json({
          code: "field.invalid_pec_date",
          error: "field_invalid_pec_date",
          message: "PEC expiration date must be YYYY-MM-DD",
        });
        return;
      }
      updates.pecExpirationDate = String(raw);
      updates.pecCertification = true;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(vendorPeopleTable).set(updates).where(eq(vendorPeopleTable.id, ctx.employee.id));
  }

  // Keep linked user displayName in sync with name changes.
  if (("firstName" in updates || "lastName" in updates)) {
    const newFirst = (updates.firstName as string) ?? ctx.employee.firstName;
    const newLast = (updates.lastName as string) ?? ctx.employee.lastName;
    const display = `${newFirst} ${newLast}`.trim();
    if (display) {
      await db.update(usersTable).set({ displayName: display }).where(eq(usersTable.id, ctx.session.userId));
    }
  }

  const [extra] = await db
    .select({
      profilePhotoPath: vendorPeopleTable.profilePhotoPath,
      jobTitle: vendorPeopleTable.jobTitle,
      phone: vendorPeopleTable.phone,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      pecExpirationDate: vendorPeopleTable.pecExpirationDate,
      pecCertification: vendorPeopleTable.pecCertification,
    })
    .from(vendorPeopleTable)
    .where(eq(vendorPeopleTable.id, ctx.employee.id));
  res.json(extra ?? {});
});

// ── POST /api/field/me/password — change current field employee password ──
router.post("/field/me/password", async (req, res): Promise<void> => {
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return;
  const { currentPassword, newPassword } = (req.body ?? {}) as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    res.status(400).json({
      code: "field.password_required",
      error: "field_password_required",
      message: "Current and new password are required",
    });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({
      code: "field.password_too_short",
      error: "field_password_too_short",
      message: "New password must be at least 8 characters",
    });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, ctx.session.userId));
  if (!user) {
    res.status(404).json({
      code: "field.user_not_found",
      error: "field_user_not_found",
      message: "User not found",
    });
    return;
  }
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({
      code: "field.current_password_incorrect",
      error: "field_current_password_incorrect",
      message: "Current password is incorrect",
    });
    return;
  }
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, ctx.session.userId));
  res.status(204).send();
});

// ── GET /api/field/history — closed/past tickets for the current field employee ──
router.get("/field/history", async (req, res): Promise<void> => {
  // Task #761: same per-session cap that protects /api/tickets and
  // /api/tickets/:id (Task #675/#687). The mobile History tab and a
  // misbehaving client share this budget so a runaway poll loop on
  // the field endpoints can't outrun the office-app guard rail.
  // Enforced before requireFieldUser so abusive unauthenticated
  // traffic still counts against the IP-keyed bucket.
  const earlySession = getSession(req);
  if (!await enforceTicketsRateLimit(req, res, earlySession)) return;
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return;

  const rows = await db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      checkInTime: ticketsTable.checkInTime,
      checkOutTime: ticketsTable.checkOutTime,
      siteLocationId: ticketsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      partnerName: partnersTable.name,
      workTypeId: ticketsTable.workTypeId,
      workTypeName: workTypesTable.name,
      createdAt: ticketsTable.createdAt,
      // Task #605: mobile history pill escalates to amber when the
      // ticket has gone untouched for the same 7-day window the web
      // dispatcher view uses, so it needs the same updatedAt the web
      // TicketStatusBadge consumes.
      updatedAt: ticketsTable.updatedAt,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .leftJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
    .where(and(
      eq(ticketsTable.vendorId, ctx.employee.vendorId),
      eq(ticketsTable.fieldEmployeeId, ctx.employee.id),
      inArray(ticketsTable.status, ["completed", "submitted", "approved", "cancelled"]),
    ))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(100);

  res.json(rows);
});

// ── GET /api/field/sites — sites approved for current vendor ──
router.get("/field/sites", async (req, res): Promise<void> => {
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return;

  const result = await db.execute(sql`
    SELECT DISTINCT s.id, s.name, s.address, s.state, s.site_code AS "siteCode",
           s.partner_id AS "partnerId", p.name AS "partnerName"
    FROM site_work_assignments swa
    INNER JOIN site_locations s ON s.id = swa.site_location_id
    LEFT JOIN partners p ON p.id = s.partner_id
    WHERE swa.vendor_id = ${ctx.employee.vendorId}
    ORDER BY s.name
  `);
  res.json(result.rows);
});

// ── GET /api/field/sites/:siteId/work-types — approved work types for this site ──
router.get("/field/sites/:siteId/work-types", async (req, res): Promise<void> => {
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return;
  const siteId = parseInt(req.params.siteId);
  if (Number.isNaN(siteId)) {
    res.status(400).json({
      code: "field.invalid_site_id",
      error: "field_invalid_site_id",
      message: "Invalid siteId",
    });
    return;
  }

  const rows = await db
    .select({
      id: workTypesTable.id,
      name: workTypesTable.name,
      category: workTypesTable.category,
    })
    .from(siteWorkAssignmentsTable)
    .innerJoin(workTypesTable, eq(siteWorkAssignmentsTable.workTypeId, workTypesTable.id))
    .where(and(
      eq(siteWorkAssignmentsTable.vendorId, ctx.employee.vendorId),
      eq(siteWorkAssignmentsTable.siteLocationId, siteId),
    ))
    .orderBy(workTypesTable.name);

  res.json(rows);
});

// ── GET /api/field/open-tickets — open tickets for this viewer ──
//
// Accepts both field-employee and vendor-admin sessions:
//   * field_employee → tickets owned by this employee on their vendor.
//   * vendor (admin)  → ALL open tickets for this vendor across every
//                       field employee. Lets a vendor admin survey
//                       team activity from the iOS app, read-only.
// Both modes apply the same open-status filter and the same vendorId
// scope, so a vendor admin never sees tickets outside their org.
router.get("/field/open-tickets", async (req, res): Promise<void> => {
  // Task #761: share the per-session tickets rate-limit budget so a
  // runaway client can't hammer the field-specific list endpoint and
  // dodge the cap that already protects /api/tickets.
  const earlySession = getSession(req);
  if (!await enforceTicketsRateLimit(req, res, earlySession)) return;
  const ctx = await requireFieldOrVendor(req, res);
  if (!ctx) return;

  // Field employees AND foremen only see tickets that are still
  // actively in their court: `initiated` and `in_progress`. Anything
  // past that (`pending_review`, `kicked_back`, `submitted`, etc.) is
  // off their list. A `kicked_back` ticket only comes back into view
  // after office staff explicitly re-opens it (which moves the status
  // back to `in_progress`). Vendor office admins on mobile keep the
  // broader list so they can survey team activity including review
  // queues.
  //
  // We treat the viewer as "narrow" if EITHER:
  //   - the route resolved them as field-mode (top-level role
  //     field_employee), OR
  //   - their session carries vendorRole === "foreman" (a foreman who
  //     was hydrated through the vendor branch — e.g. a foreman whose
  //     top-level role is `vendor` on a particular membership).
  // This way a foreman never sees pending_review/kicked_back regardless
  // of which auth path their session walked.
  const isForemanSession =
    ctx.session.vendorRole === "foreman" || ctx.session.vendorRole === "both";
  const isNarrowViewer = ctx.mode === "field" || isForemanSession;
  const narrowStatuses = ["initiated", "in_progress"];
  const broadStatuses = [
    "initiated",
    "draft",
    "in_progress",
    "kicked_back",
    "pending_review",
  ];
  const conditions = [
    eq(ticketsTable.vendorId, ctx.vendorId),
    inArray(
      ticketsTable.status,
      isNarrowViewer ? narrowStatuses : broadStatuses,
    ),
  ];
  if (ctx.mode === "field") {
    if (isForemanSession) {
      const crewRows = await db
        .select({ ticketId: ticketCrewTable.ticketId })
        .from(ticketCrewTable)
        .where(and(
          eq(ticketCrewTable.employeeId, ctx.employee.id),
          isNull(ticketCrewTable.removedAt),
        ));
      const crewTicketIds = crewRows.map((row) => row.ticketId);
      conditions.push(or(
        eq(ticketsTable.fieldEmployeeId, ctx.employee.id),
        eq(ticketsTable.foremanUserId, ctx.session.userId),
        crewTicketIds.length > 0
          ? inArray(ticketsTable.id, crewTicketIds)
          : sql`false`,
      )!);
    } else {
      conditions.push(eq(ticketsTable.fieldEmployeeId, ctx.employee.id));
    }
  }

  const rows = await db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      checkInTime: ticketsTable.checkInTime,
      siteLocationId: ticketsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      partnerName: partnersTable.name,
      workTypeId: ticketsTable.workTypeId,
      workTypeName: workTypesTable.name,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      foremanUserId: ticketsTable.foremanUserId,
      fieldEmployeeFirstName: vendorPeopleTable.firstName,
      fieldEmployeeLastName: vendorPeopleTable.lastName,
      createdAt: ticketsTable.createdAt,
      // Task #605: mobile open-tickets pill mirrors the web 7-day
      // inactivity escalation, which keys off updatedAt.
      updatedAt: ticketsTable.updatedAt,
      // Task #51 — unread comment badge. Counts ticket-thread comments
      // this viewer hasn't seen yet (excluding their own and deleted).
      // Drops back to 0 the next time the list re-fetches after the
      // detail screen runs `markAllSeen` on its comments thread.
      unreadCommentCount: unreadTicketCommentCountSql(
        sql`${ticketsTable.id}`,
        ctx.session.userId,
      ),
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .leftJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
    .leftJoin(vendorPeopleTable, eq(ticketsTable.fieldEmployeeId, vendorPeopleTable.id))
    .where(and(...conditions))
    .orderBy(desc(ticketsTable.createdAt));

  res.json(rows);
});

// ── GET /api/field/open-tickets/:id — single open-ticket row for this field employee ──
//
// Task #668 — companion to GET /api/field/open-tickets that returns the
// same denormalized row shape (siteName/partnerName/workTypeName joins,
// status, createdAt, etc.) for one ticket. The mobile open-tickets list
// uses this for the surgical per-row refresh on a foreground
// `ticket_unblocked` push so a single ticket transition no longer
// triggers a full /api/field/open-tickets refetch on a slow link.
//
// Visibility rules mirror the list endpoint exactly:
//   * field_employee → scoped to (this employee's vendor, this employee's id)
//   * vendor (admin)  → scoped to vendorId only (any employee on that vendor)
//   * status restricted to the same five "open" statuses
// A ticket that fails either check responds 404 so the client knows the
// row should be dropped from local state (e.g. the office reassigned
// the ticket to a different field employee, or the worker closed it
// in another tab).
router.get("/field/open-tickets/:id", async (req, res): Promise<void> => {
  // Task #761: same per-session cap as the list endpoint and
  // /api/tickets/:id, so the surgical per-row refresh path can't be
  // looped to bypass the tickets-detail budget.
  const earlySession = getSession(req);
  if (!await enforceTicketsRateLimit(req, res, earlySession)) return;
  const ctx = await requireFieldOrVendor(req, res);
  if (!ctx) return;

  const ticketId = Number(req.params.id);
  if (!Number.isInteger(ticketId) || ticketId < 1) {
    res.status(400).json({
      code: "field.invalid_ticket_id",
      error: "field_invalid_ticket_id",
      message: "invalid ticket id",
    });
    return;
  }

  const conditions = [
    eq(ticketsTable.id, ticketId),
    eq(ticketsTable.vendorId, ctx.vendorId),
    inArray(ticketsTable.status, [
      "initiated",
      "draft",
      "in_progress",
      "kicked_back",
      "pending_review",
    ]),
  ];
  if (ctx.mode === "field") {
    conditions.push(eq(ticketsTable.fieldEmployeeId, ctx.employee.id));
  }

  const [row] = await db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      checkInTime: ticketsTable.checkInTime,
      siteLocationId: ticketsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      partnerName: partnersTable.name,
      workTypeId: ticketsTable.workTypeId,
      workTypeName: workTypesTable.name,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      fieldEmployeeFirstName: vendorPeopleTable.firstName,
      fieldEmployeeLastName: vendorPeopleTable.lastName,
      createdAt: ticketsTable.createdAt,
      // Task #605: matches the list endpoint so the surgical per-row
      // refresh keeps the inactivity-escalated pill color correct.
      updatedAt: ticketsTable.updatedAt,
      // Task #51 — must mirror the list endpoint so the surgical
      // per-row refresh keeps the unread-comment badge in sync.
      unreadCommentCount: unreadTicketCommentCountSql(
        sql`${ticketsTable.id}`,
        ctx.session.userId,
      ),
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .leftJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
    .leftJoin(vendorPeopleTable, eq(ticketsTable.fieldEmployeeId, vendorPeopleTable.id))
    .where(and(...conditions));

  if (!row) {
    res.status(404).json({
      code: "field.ticket_not_found",
      error: "field_ticket_not_found",
      message: "ticket not found",
    });
    return;
  }

  res.json(row);
});

// ── GET /api/field/foremen — vendor people on this vendor who can be foremen ──
//
// Task #498: backs the "suggested foreman = self (overridable)" picker
// on the mobile new-ticket / adjacent-ticket form. Field-employee users
// don't have access to the vendor-side `/api/field-employees` listing
// (admin/vendor role only), so we expose a narrow, field-scoped read
// here that lists exactly the vendor_people in the current employee's
// vendor whose vendor_role is `foreman` or `both`. The shape is
// intentionally minimal — `userId` is the value the new-ticket form
// forwards as `foremanUserId` on POST /api/field/tickets, and
// `firstName` / `lastName` give the picker a label. Inactive or
// soft-deleted rows are excluded so the picker can't suggest someone
// who no longer works there.
router.get("/field/foremen", async (req, res): Promise<void> => {
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return;
  const rows = await db
    .select({
      vendorPersonId: vendorPeopleTable.id,
      userId: vendorPeopleTable.userId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
    })
    .from(vendorPeopleTable)
    .where(and(
      eq(vendorPeopleTable.vendorId, ctx.employee.vendorId),
      eq(vendorPeopleTable.isActive, true),
      isNull(vendorPeopleTable.deletedAt),
      inArray(vendorPeopleTable.vendorRole, ["foreman", "both"]),
      isNotNull(vendorPeopleTable.userId),
    ))
    .orderBy(vendorPeopleTable.firstName, vendorPeopleTable.lastName);
  res.json(rows);
});

// ── POST /api/field/tickets — create ticket + auto check-in ──
router.post("/field/tickets", async (req, res): Promise<void> => {
  try {
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return;
  const {
    siteLocationId,
    workTypeId,
    latitude,
    longitude,
    description,
    initialState,
    adjacent,
    foremanUserId: rawForemanUserId,
    startingMileage: rawStartingMileage,
  } = req.body ?? {};

  // T004: field self-create may include the starting odometer. The
  // mobile new-ticket form prompts for it whenever `initialState ===
  // 'pending_arrival'` (the en-route lifecycle starts implicitly with
  // ticket creation in that path) so the value is captured at the same
  // moment as a stand-alone /en-route press would capture it.
  let startingMileage: string | null = null;
  if (rawStartingMileage != null) {
    const n = Number(rawStartingMileage);
    if (!Number.isFinite(n) || n < 0) {
      res.status(400).json({
        code: "field_ticket.starting_mileage_invalid",
        error: "starting_mileage_invalid",
        message: "Starting mileage must be a non-negative number",
      });
      return;
    }
    startingMileage = (Math.round(n * 10) / 10).toFixed(1);
  }
  if (!siteLocationId || !workTypeId) {
    res.status(400).json({
      code: "field.site_and_work_type_required",
      error: "field_site_and_work_type_required",
      message: "siteLocationId and workTypeId are required",
    });
    return;
  }

  // Look up site first so we can both (a) emit a structured
  // `site_not_found` code if the row is missing and (b) reuse the
  // coordinates for the geofence check below. Mirrors the office
  // POST /tickets path (Task #517) so the mobile new-ticket form can
  // surface the validation inline next to the offending picker via the
  // shared `errors.<code>` lookup in artifacts/vndrly-mobile/lib/apiErrors.ts.
  const [site] = await db
    .select({
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteLocationId));
  if (!site) {
    res.status(400).json({
      code: "field_ticket.site_not_found",
      error: "site_not_found",
      message: "Site not found.",
    });
    return;
  }

  // Task #528: split the legacy single 403 ("Not approved for this
  // site & work type") into structured codes so the mobile new-ticket
  // screen can surface the validation inline on the right picker.
  //
  // The happy path stays a single (vendor, site, work_type) query. On
  // miss we narrow the diagnosis with one extra read:
  //   * vendor has no assignment at this site at all → emit
  //     `site_vendor_mismatch` (400). Site picker is wrong.
  //   * vendor IS at the site but not for this work type → emit
  //     `work_type_not_allowed` (400). Work-type picker is wrong.
  // These two 400 codes fully replace the legacy 403 — the new mobile
  // UI keys off `err.data.error` and never sees a status code.
  const [assignment] = await db
    .select({ id: siteWorkAssignmentsTable.id })
    .from(siteWorkAssignmentsTable)
    .where(and(
      eq(siteWorkAssignmentsTable.vendorId, ctx.employee.vendorId),
      eq(siteWorkAssignmentsTable.siteLocationId, siteLocationId),
      eq(siteWorkAssignmentsTable.workTypeId, workTypeId),
    ));
  if (!assignment) {
    const [vendorAssignment] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(and(
        eq(siteWorkAssignmentsTable.vendorId, ctx.employee.vendorId),
        eq(siteWorkAssignmentsTable.siteLocationId, siteLocationId),
      ));
    if (!vendorAssignment) {
      res.status(400).json({
        code: "field_ticket.site_vendor_mismatch",
        error: "site_vendor_mismatch",
        message: "Vendor is not assigned to work at this site.",
      });
      return;
    }
    // (vendor, site) row exists but the (vendor, site, work_type) row
    // doesn't — it's the work type, not the site, that the vendor isn't
    // approved for.
    res.status(400).json({
      code: "field_ticket.work_type_not_allowed",
      error: "work_type_not_allowed",
      message: "Vendor is not approved for this work type at this site.",
    });
    return;
  }

  const DEFAULT_RADIUS = 150;
  const hasCoords = typeof latitude === "number" && typeof longitude === "number";
  let insideGeofence = false;
  if (hasCoords && site) {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(site.latitude - latitude);
    const dLng = toRad(site.longitude - longitude);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(latitude)) * Math.cos(toRad(site.latitude)) * Math.sin(dLng / 2) ** 2;
    const meters = 2 * R * Math.asin(Math.sqrt(a));
    insideGeofence = meters <= (site.siteRadiusMeters ?? DEFAULT_RADIUS);
  }
  // Demo bypass — see lib/geo.ts. While the bypass window is active treat
  // any submitted coords as inside the geofence so field self-create lands
  // on_site / in_progress regardless of the device's actual location.
  if (hasCoords && isGeofenceBypassActive()) {
    insideGeofence = true;
  }

  const requestedState = initialState === "pending_arrival" ? "pending_arrival" : "on_site";
  // Task #498: an "adjacent" ticket is initiated by a field employee who
  // is already on-site for another ticket on the same location. The
  // crew/site is already coordinated, so we accept the implicit check-in
  // and skip the geofence requirement — drop straight into in_progress
  // regardless of whether device GPS happens to land inside the polygon
  // at the moment of submission.
  const isAdjacent = adjacent === true || adjacent === "1";
  const shouldCheckIn =
    isAdjacent || (requestedState === "on_site" && insideGeofence);
  const now = new Date();
  const initialStatus = shouldCheckIn ? "in_progress" : "initiated";

  // Task #498: "suggested foreman = self (overridable)". Default the
  // foreman attribution to the creating field employee so the on-site
  // lead is recorded automatically — but allow the mobile new-ticket
  // form to override with another vendor person who is foreman-eligible
  // (vendor_role IN ('foreman','both')) on the SAME vendor. We silently
  // fall back to self for any invalid override (wrong vendor, missing
  // role, soft-deleted, inactive) so a buggy or malicious client cannot
  // attribute a job to someone who isn't a real foreman on this vendor.
  // /api/field/foremen above lists exactly the eligible options the
  // picker should show.
  let resolvedForemanUserId: number = ctx.session.userId;
  const overrideId =
    typeof rawForemanUserId === "number" && Number.isInteger(rawForemanUserId)
      ? rawForemanUserId
      : null;
  if (overrideId != null && overrideId !== ctx.session.userId) {
    const [foreman] = await db
      .select({ userId: vendorPeopleTable.userId })
      .from(vendorPeopleTable)
      .where(and(
        eq(vendorPeopleTable.userId, overrideId),
        eq(vendorPeopleTable.vendorId, ctx.employee.vendorId),
        eq(vendorPeopleTable.isActive, true),
        isNull(vendorPeopleTable.deletedAt),
        inArray(vendorPeopleTable.vendorRole, ["foreman", "both"]),
      ));
    if (foreman?.userId != null) {
      resolvedForemanUserId = foreman.userId;
    }
  }

  // Field self-create is always vendor_field_self_service per the lifecycle
  // spec — the office-on-behalf paths land in routes/tickets.ts instead.
  const ticket = await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(ticketsTable)
      .values({
        siteLocationId,
        vendorId: ctx.employee.vendorId,
        fieldEmployeeId: ctx.employee.id,
        workTypeId,
        status: initialStatus,
        intakeChannel: "vendor_field_self_service",
        lifecycleState: shouldCheckIn ? "on_site" : "pending_arrival",
        description: description || null,
        checkInTime: shouldCheckIn ? now : null,
        arrivedAt: shouldCheckIn ? now : null,
        checkInLatitude: shouldCheckIn ? latitude : null,
        checkInLongitude: shouldCheckIn ? longitude : null,
        startingMileage,
        // Task #498: field self-create defaults foreman to the creator so a
        // freshly opened ticket is immediately attributed to the on-site
        // lead. Spec calls for this to be overridable — see
        // resolvedForemanUserId above for the validated override path.
        foremanUserId: resolvedForemanUserId,
      })
      .returning();
    await recordTicketTransition({
      tx,
      ticketId: t.id,
      fromStatus: null,
      toStatus: initialStatus,
      actorUserId: ctx.session.userId,
      actorRole: ctx.session.role,
      reason: shouldCheckIn ? "field self-create with auto-check-in" : "field self-create",
    });
    return t;
  });

  if (shouldCheckIn && hasCoords) {
    await db.insert(gpsLogsTable).values({
      ticketId: ticket.id,
      latitude,
      longitude,
      eventType: "check_in",
    });
  }

  // Dual-write a ticket_check_ins session whenever the field self-create
  // path auto-checks-in. Without this row regenerateAutoLaborLines() finds
  // zero sessions on check-out and inserts zero [auto] labor rows, so the
  // vendor's Parts & Labor tab stays empty even after a full work day
  // (root cause of T001 — ticket 136 only had a session because someone
  // later added Joe via the crew flow). hourly_rate_at_time freezes
  // whatever rate vendor_people.hourly_rate is at clock-in so a later
  // people-record edit doesn't retroactively rewrite history.
  if (shouldCheckIn) {
    await db.insert(ticketCheckInsTable).values({
      ticketId: ticket.id,
      employeeId: ctx.employee.id,
      checkInAt: now,
      checkInLatitude: hasCoords ? latitude : null,
      checkInLongitude: hasCoords ? longitude : null,
      hourlyRateAtTime: ctx.employee.hourlyRate ?? null,
      source: "auto",
    });
  }

  // Push notification to the field employee that a tracking number is now assigned to them.
  void sendPushToFieldEmployee(ctx.employee.id, {
    title: "New Tracking Started",
    body: `Tracking #${String(ticket.id).padStart(4, "0")} is now in progress.`,
    data: { ticketId: ticket.id, type: "ticket_assigned" },
  });

  res.status(201).json(ticket);
  } catch (err) {
    req.log.error({ err }, "POST /field/tickets failed");
    res.status(500).json({
      code: "field_ticket.create_failed",
      error: "internal_error",
      message: "Failed to create ticket",
    });
  }
});

// ── POST /api/field/push-token — register expo push token for current user ──
router.post("/field/push-token", async (req, res): Promise<void> => {
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return;
  const { token, platform } = req.body ?? {};
  if (!token || typeof token !== "string") {
    res.status(400).json({
      code: "field.token_required",
      error: "field_token_required",
      message: "token required",
    });
    return;
  }
  await db
    .insert(fieldPushTokensTable)
    .values({ userId: ctx.session.userId, expoToken: token, platform: platform ?? null })
    .onConflictDoUpdate({
      target: fieldPushTokensTable.expoToken,
      set: { userId: ctx.session.userId, platform: platform ?? null },
    });
  res.status(204).send();
});

// ── DELETE /api/field/push-token — unregister expo push token ──
router.delete("/field/push-token", async (req, res): Promise<void> => {
  const ctx = await requireFieldUser(req, res);
  if (!ctx) return;
  const { token } = req.body ?? {};
  if (!token) {
    res.status(400).json({
      code: "field.token_required",
      error: "field_token_required",
      message: "token required",
    });
    return;
  }
  await db.delete(fieldPushTokensTable).where(eq(fieldPushTokensTable.expoToken, token));
  res.status(204).send();
});

// ── POST /api/field-employees/:id/login — set or update login credentials ──
router.post("/field-employees/:id/login", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({
      code: "field.admin_or_vendor_login_required",
      error: "field_admin_or_vendor_login_required",
      message: "Admin or vendor login required",
    });
    return;
  }
  const employeeId = parseInt(req.params.id);
  const { email, password, displayName, preferredLanguage } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({
      code: "field.email_and_password_required",
      error: "field_email_and_password_required",
      message: "email and password are required",
    });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({
      code: "field.password_too_short",
      error: "field_password_too_short",
      message: "Password must be at least 8 characters",
    });
    return;
  }
  if (preferredLanguage !== undefined && preferredLanguage !== null && normalizeLanguage(preferredLanguage) === null) {
    res.status(400).json({
      code: "field.invalid_preferred_language",
      error: "field_invalid_preferred_language",
      message: "preferredLanguage must be 'en' or 'es'",
    });
    return;
  }
  const langForInsert = normalizeLanguage(preferredLanguage);
  const langProvided = preferredLanguage !== undefined;

  const [employee] = await db
    .select()
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.id, employeeId), isNull(vendorPeopleTable.deletedAt)));
  if (!employee) {
    res.status(404).json({
      code: "field.employee_not_found",
      error: "field_employee_not_found",
      message: "Employee not found",
    });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== employee.vendorId) {
    res.status(403).json({
      code: "field.employee_outside_vendor",
      error: "field_employee_outside_vendor",
      message: "Cannot manage employees outside your vendor",
    });
    return;
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const finalDisplayName = displayName || `${employee.firstName} ${employee.lastName}`.trim() || email;

  try {
    const result = await db.transaction(async (tx) => {
      if (employee.userId) {
        const [existing] = await tx.select().from(usersTable).where(eq(usersTable.id, employee.userId));
        if (existing && existing.role !== "field_employee") {
          throw Object.assign(new Error("Linked user is not a field_employee account"), { http: 409 });
        }
        const [conflict] = await tx.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.username, email), ne(usersTable.id, employee.userId)));
        if (conflict) throw Object.assign(new Error("That email is already in use by another login"), { http: 409 });
        // The (user, vendor) membership row below is the authoritative
        // source for org assignment.
        const updateValues: Record<string, unknown> = {
          username: email,
          // Keep `users.email` in sync with the login email so visitor
          // notification lookups (which join by email) keep working.
          email,
          passwordHash,
          displayName: finalDisplayName,
          role: "field_employee",
        };
        if (langProvided) updateValues.preferredLanguage = langForInsert;
        await tx
          .update(usersTable)
          .set(updateValues)
          .where(eq(usersTable.id, employee.userId));
        await ensureFieldEmployeeMembershipTx(tx, employee.userId, employee.vendorId, employeeId);
        return { userId: employee.userId, status: "updated" as const };
      }
      const [conflict] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, email));
      if (conflict) throw Object.assign(new Error("That email is already in use by another login"), { http: 409 });
      const [newUser] = await tx
        .insert(usersTable)
        .values({
          username: email,
          email,
          passwordHash,
          role: "field_employee",
          displayName: finalDisplayName,
          preferredLanguage: langForInsert,
        })
        .returning();
      await tx
        .update(vendorPeopleTable)
        .set({ userId: newUser.id, email })
        .where(eq(vendorPeopleTable.id, employeeId));
      await ensureFieldEmployeeMembershipTx(tx, newUser.id, employee.vendorId, employeeId);
      return { userId: newUser.id, status: "created" as const };
    });
    // The membership row is inserted by ensureFieldEmployeeMembershipTx
    // inside the transaction above, so the user is never visible
    // without it.
    res.status(result.status === "created" ? 201 : 200).json({ employeeId, userId: result.userId, email, status: result.status, preferredLanguage: langForInsert });
  } catch (err: any) {
    res.status(err.http || 500).json({ message: err.message || "Failed to save credentials" });
  }
});

// ── POST /api/field-employees/bulk-login — batch create/update credentials ──
// Accepts CSV-style rows so admins can onboard many users at once.
// Each row: { employeeId, email, password, displayName?, preferredLanguage? }
router.post("/field-employees/bulk-login", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({
      code: "field.admin_or_vendor_login_required",
      error: "field_admin_or_vendor_login_required",
      message: "Admin or vendor login required",
    });
    return;
  }
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || rows.length === 0) {
    res.status(400).json({
      code: "field.rows_required",
      error: "field_rows_required",
      message: "rows array is required",
    });
    return;
  }
  if (rows.length > 500) {
    res.status(400).json({
      code: "field.rows_too_many",
      error: "field_rows_too_many",
      message: "rows must be 500 or fewer per request",
    });
    return;
  }

  const results: Array<{
    index: number;
    employeeId?: number;
    userId?: number;
    email?: string;
    status: "created" | "updated" | "error";
    message?: string;
    preferredLanguage?: "en" | "es" | "pt" | null;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? {};
    const employeeId = Number(row.employeeId);
    const email = typeof row.email === "string" ? row.email.trim() : "";
    const password = typeof row.password === "string" ? row.password : "";
    const displayName = typeof row.displayName === "string" ? row.displayName : undefined;
    const langRaw = row.preferredLanguage ?? row.language;
    if (langRaw !== undefined && langRaw !== null && langRaw !== "" && normalizeLanguage(langRaw) === null) {
      results.push({ index: i, status: "error", message: "preferredLanguage must be 'en', 'es', or 'pt'" });
      continue;
    }
    const langForInsert = normalizeLanguage(langRaw);
    const langProvided = langRaw !== undefined;

    if (!Number.isFinite(employeeId) || !email || !password) {
      results.push({ index: i, status: "error", message: "employeeId, email, and password are required" });
      continue;
    }
    if (password.length < 8) {
      results.push({ index: i, employeeId, status: "error", message: "Password must be at least 8 characters" });
      continue;
    }
    const [employee] = await db
      .select()
      .from(vendorPeopleTable)
      .where(and(eq(vendorPeopleTable.id, employeeId), isNull(vendorPeopleTable.deletedAt)));
    if (!employee) {
      results.push({ index: i, employeeId, status: "error", message: "Employee not found" });
      continue;
    }
    if (session.role === "vendor" && session.vendorId !== employee.vendorId) {
      results.push({ index: i, employeeId, status: "error", message: "Cannot manage employees outside your vendor" });
      continue;
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    const finalDisplayName = displayName || `${employee.firstName} ${employee.lastName}`.trim() || email;
    try {
      const result = await db.transaction(async (tx) => {
        if (employee.userId) {
          const [existing] = await tx.select().from(usersTable).where(eq(usersTable.id, employee.userId));
          if (existing && existing.role !== "field_employee") {
            throw Object.assign(new Error("Linked user is not a field_employee account"), { http: 409 });
          }
          const [conflict] = await tx.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.username, email), ne(usersTable.id, employee.userId)));
          if (conflict) throw Object.assign(new Error("That email is already in use by another login"), { http: 409 });
          // The (user, vendor) membership row below is the authoritative
          // source for org assignment.
          const updateValues: Record<string, unknown> = {
            username: email,
            // Mirror `username` into the `email` column so visitor
            // notification recipient lookups stay accurate after a
            // bulk credential refresh.
            email,
            passwordHash,
            displayName: finalDisplayName,
            role: "field_employee",
          };
          if (langProvided) updateValues.preferredLanguage = langForInsert;
          await tx.update(usersTable).set(updateValues).where(eq(usersTable.id, employee.userId));
          await ensureFieldEmployeeMembershipTx(tx, employee.userId, employee.vendorId, employeeId);
          return { userId: employee.userId, status: "updated" as const };
        }
        const [conflict] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, email));
        if (conflict) throw Object.assign(new Error("That email is already in use by another login"), { http: 409 });
        const [newUser] = await tx
          .insert(usersTable)
          .values({
            username: email,
            email,
            passwordHash,
            role: "field_employee",
            displayName: finalDisplayName,
            preferredLanguage: langForInsert,
          })
          .returning();
        await tx.update(vendorPeopleTable).set({ userId: newUser.id, email }).where(eq(vendorPeopleTable.id, employeeId));
        await ensureFieldEmployeeMembershipTx(tx, newUser.id, employee.vendorId, employeeId);
        return { userId: newUser.id, status: "created" as const };
      });
      // The membership row is inserted by ensureFieldEmployeeMembershipTx
      // inside the transaction above, so the user is never visible
      // without it.
      results.push({ index: i, employeeId, userId: result.userId, email, status: result.status, preferredLanguage: langForInsert });
    } catch (err: any) {
      results.push({ index: i, employeeId, status: "error", message: err.message || "Failed to save credentials" });
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  const updated = results.filter((r) => r.status === "updated").length;
  const errors = results.filter((r) => r.status === "error").length;
  res.status(errors === results.length ? 400 : 200).json({ created, updated, errors, results });
});

// ── DELETE /api/field-employees/:id/login — disable credentials ──
router.delete("/field-employees/:id/login", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({
      code: "field.admin_or_vendor_login_required",
      error: "field_admin_or_vendor_login_required",
      message: "Admin or vendor login required",
    });
    return;
  }
  const employeeId = parseInt(req.params.id);
  const [employee] = await db.select().from(vendorPeopleTable).where(and(eq(vendorPeopleTable.id, employeeId), isNull(vendorPeopleTable.deletedAt)));
  if (!employee) {
    res.status(404).json({
      code: "field.employee_not_found",
      error: "field_employee_not_found",
      message: "Employee not found",
    });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== employee.vendorId) {
    res.status(403).json({
      code: "field.employee_outside_vendor",
      error: "field_employee_outside_vendor",
      message: "Cannot manage employees outside your vendor",
    });
    return;
  }
  if (employee.userId) {
    // Only target THIS field-employee's membership rows. Scope by
    // role=field_employee + vendorPeopleId so we never collateral-
    // delete an admin/member membership the same login may also have
    // on this vendor (rare but possible after dual-role invites).
    const memberships = await db
      .select({ id: userOrgMembershipsTable.id })
      .from(userOrgMembershipsTable)
      .where(and(
        eq(userOrgMembershipsTable.userId, employee.userId),
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, employee.vendorId),
        eq(userOrgMembershipsTable.role, "field_employee"),
        eq(userOrgMembershipsTable.vendorPeopleId, employeeId),
      ));
    for (const m of memberships) {
      await removeMembership(m.id);
    }
    await db.transaction(async (tx) => {
      // Only delete the user if it's actually a field_employee account, never an admin/vendor/partner.
      await tx.delete(usersTable).where(and(
        eq(usersTable.id, employee.userId!),
        eq(usersTable.role, "field_employee"),
      ));
      await tx.update(vendorPeopleTable).set({ userId: null }).where(eq(vendorPeopleTable.id, employeeId));
    });
  }
  res.status(204).send();
});

// ── GET /api/field-employees/:id/login — get login status ──
router.get("/field-employees/:id/login", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({
      code: "field.admin_or_vendor_login_required",
      error: "field_admin_or_vendor_login_required",
      message: "Admin or vendor login required",
    });
    return;
  }
  const employeeId = parseInt(req.params.id);
  const [employee] = await db.select().from(vendorPeopleTable).where(and(eq(vendorPeopleTable.id, employeeId), isNull(vendorPeopleTable.deletedAt)));
  if (!employee) {
    res.status(404).json({
      code: "field.employee_not_found",
      error: "field_employee_not_found",
      message: "Employee not found",
    });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== employee.vendorId) {
    res.status(403).json({
      code: "field.employee_view_outside_vendor",
      error: "field_employee_view_outside_vendor",
      message: "Cannot view employees outside your vendor",
    });
    return;
  }
  if (!employee.userId) {
    res.json({ hasLogin: false });
    return;
  }
  const [user] = await db
    .select({ id: usersTable.id, username: usersTable.username, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, employee.userId));
  if (!user || user.role !== "field_employee") {
    res.json({ hasLogin: false });
    return;
  }
  res.json({ hasLogin: true, email: user.username, userId: user.id });
});

// ── GET /api/field/co-workers — active vendor people for foreman crew tools ──
router.get("/field/co-workers", async (req, res): Promise<void> => {
  const ctx = await requireForemanFieldUser(req, res);
  if (!ctx) return;
  const rows = await db
    .select({
      id: vendorPeopleTable.id,
      userId: vendorPeopleTable.userId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      vendorRole: vendorPeopleTable.vendorRole,
      jobTitle: vendorPeopleTable.jobTitle,
    })
    .from(vendorPeopleTable)
    .where(and(
      eq(vendorPeopleTable.vendorId, ctx.employee.vendorId),
      eq(vendorPeopleTable.isActive, true),
      isNull(vendorPeopleTable.deletedAt),
    ))
    .orderBy(vendorPeopleTable.firstName, vendorPeopleTable.lastName);
  res.json(rows);
});

// ── GET /api/field/crew-presets ──
router.get("/field/crew-presets", async (req, res): Promise<void> => {
  const ctx = await requireForemanFieldUser(req, res);
  if (!ctx) return;
  const rows = await db
    .select()
    .from(vendorCrewPresetsTable)
    .where(eq(vendorCrewPresetsTable.vendorId, ctx.employee.vendorId))
    .orderBy(vendorCrewPresetsTable.name);
  res.json(rows.map((row) => ({
    id: row.id,
    name: row.name,
    memberEmployeeIds: parseEmployeeIdList(row.memberEmployeeIds),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })));
});

// ── POST /api/field/crew-presets ──
router.post("/field/crew-presets", async (req, res): Promise<void> => {
  const ctx = await requireForemanFieldUser(req, res);
  if (!ctx) return;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ code: "validation.required", message: "name required" });
    return;
  }
  const memberEmployeeIds = parseEmployeeIdList(req.body?.memberEmployeeIds);
  if (memberEmployeeIds.length > 0) {
    const valid = await db
      .select({ id: vendorPeopleTable.id })
      .from(vendorPeopleTable)
      .where(and(
        inArray(vendorPeopleTable.id, memberEmployeeIds),
        eq(vendorPeopleTable.vendorId, ctx.employee.vendorId),
        isNull(vendorPeopleTable.deletedAt),
      ));
    if (valid.length !== memberEmployeeIds.length) {
      res.status(400).json({ code: "crew.invalid_members", message: "Invalid crew members" });
      return;
    }
  }
  const now = new Date();
  const [row] = await db
    .insert(vendorCrewPresetsTable)
    .values({
      vendorId: ctx.employee.vendorId,
      name,
      memberEmployeeIds,
      createdByUserId: ctx.session.userId,
      updatedAt: now,
    })
    .returning();
  res.status(201).json({
    id: row.id,
    name: row.name,
    memberEmployeeIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
});

// ── PATCH /api/field/crew-presets/:id ──
router.patch("/field/crew-presets/:id", async (req, res): Promise<void> => {
  const ctx = await requireForemanFieldUser(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: "validation.invalid_id", message: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(vendorCrewPresetsTable)
    .where(and(
      eq(vendorCrewPresetsTable.id, id),
      eq(vendorCrewPresetsTable.vendorId, ctx.employee.vendorId),
    ));
  if (!existing) {
    res.status(404).json({ code: "crew_preset.not_found", message: "Not found" });
    return;
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.name === "string" && req.body.name.trim()) {
    patch.name = req.body.name.trim();
  }
  if (req.body?.memberEmployeeIds != null) {
    const memberEmployeeIds = parseEmployeeIdList(req.body.memberEmployeeIds);
    if (memberEmployeeIds.length > 0) {
      const valid = await db
        .select({ id: vendorPeopleTable.id })
        .from(vendorPeopleTable)
        .where(and(
          inArray(vendorPeopleTable.id, memberEmployeeIds),
          eq(vendorPeopleTable.vendorId, ctx.employee.vendorId),
          isNull(vendorPeopleTable.deletedAt),
        ));
      if (valid.length !== memberEmployeeIds.length) {
        res.status(400).json({ code: "crew.invalid_members", message: "Invalid crew members" });
        return;
      }
    }
    patch.memberEmployeeIds = memberEmployeeIds;
  }
  const [row] = await db
    .update(vendorCrewPresetsTable)
    .set(patch)
    .where(eq(vendorCrewPresetsTable.id, id))
    .returning();
  res.json({
    id: row.id,
    name: row.name,
    memberEmployeeIds: parseEmployeeIdList(row.memberEmployeeIds),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
});

// ── DELETE /api/field/crew-presets/:id ──
router.delete("/field/crew-presets/:id", async (req, res): Promise<void> => {
  const ctx = await requireForemanFieldUser(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: "validation.invalid_id", message: "Invalid id" });
    return;
  }
  const deleted = await db
    .delete(vendorCrewPresetsTable)
    .where(and(
      eq(vendorCrewPresetsTable.id, id),
      eq(vendorCrewPresetsTable.vendorId, ctx.employee.vendorId),
    ))
    .returning({ id: vendorCrewPresetsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ code: "crew_preset.not_found", message: "Not found" });
    return;
  }
  res.status(204).end();
});

// ── POST /api/field/batch-schedule-reminders ──
// Notify crews about jobs scheduled on a specific day N days from today.
router.post("/field/batch-schedule-reminders", async (req, res): Promise<void> => {
  const ctx = await requireForemanFieldUser(req, res);
  if (!ctx) return;
  const daysAhead = Number(req.body?.daysAhead);
  if (![1, 2, 3].includes(daysAhead)) {
    res.status(400).json({
      code: "validation.invalid_days_ahead",
      message: "daysAhead must be 1, 2, or 3",
    });
    return;
  }
  const target = new Date();
  target.setDate(target.getDate() + daysAhead);
  const windowStart = startOfLocalDay(target);
  const windowEnd = endOfLocalDay(target);

  const tickets = await db
    .select({
      id: ticketsTable.id,
      scheduledStartAt: ticketsTable.scheduledStartAt,
      workTypeName: workTypesTable.name,
      siteName: siteLocationsTable.name,
      siteAddress: siteLocationsTable.address,
      partnerName: partnersTable.name,
    })
    .from(ticketsTable)
    .leftJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .where(and(
      eq(ticketsTable.vendorId, ctx.employee.vendorId),
      eq(ticketsTable.foremanUserId, ctx.session.userId),
      isNotNull(ticketsTable.scheduledStartAt),
      gte(ticketsTable.scheduledStartAt, windowStart),
      lte(ticketsTable.scheduledStartAt, windowEnd),
    ));

  let notifiedUsers = 0;
  let ticketsProcessed = 0;
  for (const ticket of tickets) {
    ticketsProcessed += 1;
    const crew = await db
      .select({ userId: vendorPeopleTable.userId })
      .from(ticketCrewTable)
      .innerJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
      .where(and(
        eq(ticketCrewTable.ticketId, ticket.id),
        isNull(ticketCrewTable.removedAt),
        isNotNull(vendorPeopleTable.userId),
      ));
    const userIds = [...new Set(crew.map((c) => c.userId).filter((u): u is number => u != null))];
    if (userIds.length === 0) continue;

    const when = ticket.scheduledStartAt
      ? new Date(ticket.scheduledStartAt).toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "TBD";
    const job = ticket.workTypeName ?? "Job";
    const where = [ticket.partnerName, ticket.siteName].filter(Boolean).join(" — ") || "site";
    const title = `Scheduled in ${daysAhead} day${daysAhead === 1 ? "" : "s"}: ${job}`;
    const body = `${where}\n${when}${ticket.siteAddress ? `\n${ticket.siteAddress}` : ""}`;

    notifiedUsers += await notifyUsers(userIds, {
      type: "schedule_reminder_batch",
      title,
      body,
      link: `/tickets/${ticket.id}`,
      dedupeKey: `schedule-batch:${ticket.id}:${daysAhead}:${windowStart.toISOString().slice(0, 10)}`,
      pushData: { ticketId: ticket.id, type: "schedule_reminder_batch", daysAhead },
    });
  }

  res.json({ ok: true, ticketsProcessed, notifiedUsers, daysAhead });
});

export default router;
