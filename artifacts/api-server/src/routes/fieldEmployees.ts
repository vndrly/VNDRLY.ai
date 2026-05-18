import { Router, type IRouter } from "express";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, fieldEmployeesTable, vendorsTable, fieldEmployeeNotesTable, usersTable, ticketCheckInsTable, ticketsTable, formatTicketTrackingNumber } from "@workspace/db";
import { SESSION_SECRET } from "../lib/session";
import { sendResponse, sendResponseStatus } from "../lib/typed-response";

import { sendValidationFailed } from "../lib/validation-error";
const COOKIE_NAME = "vndrly_session";
type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null; membershipRole?: string | null };
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
import {
  CreateFieldEmployeeBody,
  GetFieldEmployeeParams,
  GetFieldEmployeeResponse,
  ListFieldEmployeesQueryParams,
  ListFieldEmployeesResponse,
  UpdateFieldEmployeeParams,
  UpdateFieldEmployeeBody,
  ListFieldEmployeeNotesParams,
  ListFieldEmployeeNotesResponse,
  CreateFieldEmployeeNoteParams,
  CreateFieldEmployeeNoteBody,
  DeleteFieldEmployeeNoteParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const baseSelect = {
  id: fieldEmployeesTable.id,
  vendorId: fieldEmployeesTable.vendorId,
  vendorRole: fieldEmployeesTable.vendorRole,
  jobTitle: fieldEmployeesTable.jobTitle,
  firstName: fieldEmployeesTable.firstName,
  lastName: fieldEmployeesTable.lastName,
  email: fieldEmployeesTable.email,
  phone: fieldEmployeesTable.phone,
  userId: fieldEmployeesTable.userId,
  vendorName: vendorsTable.name,
  vendorLogoUrl: vendorsTable.logoUrl,
  isActive: fieldEmployeesTable.isActive,
  pecCertification: fieldEmployeesTable.pecCertification,
  pecExpirationDate: fieldEmployeesTable.pecExpirationDate,
  photoUrl: fieldEmployeesTable.photoUrl,
  profilePhotoPath: fieldEmployeesTable.profilePhotoPath,
  roles: fieldEmployeesTable.roles,
  // Task #831: surface the field employee's preferred UI/assistant
  // language so the admin detail page can display & edit it. The
  // value mirrors `users.preferred_language` for the linked login
  // (kept in sync by PATCH below).
  preferredLanguage: fieldEmployeesTable.preferredLanguage,
  createdAt: fieldEmployeesTable.createdAt,
  deletedAt: fieldEmployeesTable.deletedAt,
  deletedBy: fieldEmployeesTable.deletedBy,
  // Suspension + must-change-password are owned by the linked users row.
  // The LEFT JOIN below means these are null for employees without a login.
  suspendedAt: usersTable.suspendedAt,
  mustChangePasswordRaw: usersTable.mustChangePassword,
};

// Normalize the joined select into the response shape that the OpenAPI
// FieldEmployee schema requires. `hasLogin` is derived from userId, and
// mustChangePassword falls back to false when there is no linked user.
function shapeEmployee<T extends { userId: number | null; suspendedAt: Date | string | null; mustChangePasswordRaw: boolean | null } & Record<string, unknown>>(
  row: T,
): Omit<T, "mustChangePasswordRaw"> & { hasLogin: boolean; mustChangePassword: boolean; suspendedAt: string | null } {
  const { mustChangePasswordRaw, suspendedAt, ...rest } = row;
  return {
    ...rest,
    suspendedAt:
      suspendedAt instanceof Date
        ? suspendedAt.toISOString()
        : (suspendedAt ?? null),
    hasLogin: row.userId !== null && row.userId !== undefined,
    mustChangePassword: !!mustChangePasswordRaw,
  } as Omit<T, "mustChangePasswordRaw"> & { hasLogin: boolean; mustChangePassword: boolean; suspendedAt: string | null };
}

router.get("/field-employees", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  const query = ListFieldEmployeesQueryParams.safeParse(req.query);
  const includeDeleted = session.role === "admin" && (req.query.includeDeleted === "true" || req.query.includeDeleted === "1");
  // Default to active-only so every picker (phone-intake foreman picker,
  // schedule-ticket dialog, ticket-detail crew assignment, mobile crew picker,
  // etc.) doesn't have to re-implement the same client-side filter. The
  // field-employees admin page opts back in via includeInactive=true so it
  // can still surface deactivated rows for editing/restoring.
  const includeInactive = req.query.includeInactive === "true" || req.query.includeInactive === "1";

  const fieldRoles = ["field", "both", "foreman"];
  const conds = [inArray(fieldEmployeesTable.vendorRole, fieldRoles)];
  if (!includeDeleted) conds.push(isNull(fieldEmployeesTable.deletedAt));
  if (!includeInactive) conds.push(eq(fieldEmployeesTable.isActive, true));

  // Vendors can only see their own employees; admins may filter by vendorId param
  if (session.role === "vendor") {
    if (!session.vendorId) {
      res.status(403).json({ error: "Vendor session missing vendorId" });
      return;
    }
    conds.push(eq(fieldEmployeesTable.vendorId, session.vendorId));
  } else if (query.success && query.data.vendorId) {
    conds.push(eq(fieldEmployeesTable.vendorId, query.data.vendorId));
  }

  const results = await db
    .select(baseSelect)
    .from(fieldEmployeesTable)
    .leftJoin(vendorsTable, eq(fieldEmployeesTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(fieldEmployeesTable.userId, usersTable.id))
    .where(and(...conds))
    .orderBy(fieldEmployeesTable.createdAt);

  sendResponse(res, ListFieldEmployeesResponse, results.map(shapeEmployee));
});

router.post("/field-employees", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  if (session.role === "vendor" && session.membershipRole !== "admin") {
    res.status(403).json({ error: "Vendor admin access required" });
    return;
  }

  const parsed = CreateFieldEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }

  // Vendors can only create employees for their own vendor
  if (session.role === "vendor" && parsed.data.vendorId !== session.vendorId) {
    res.status(403).json({ error: "Not allowed" });
    return;
  }

  const [employee] = await db.insert(fieldEmployeesTable).values({ ...parsed.data, vendorRole: parsed.data.vendorRole ?? "field" }).returning();

  const [result] = await db
    .select(baseSelect)
    .from(fieldEmployeesTable)
    .leftJoin(vendorsTable, eq(fieldEmployeesTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(fieldEmployeesTable.userId, usersTable.id))
    .where(eq(fieldEmployeesTable.id, employee.id));

  sendResponseStatus(res, 201, GetFieldEmployeeResponse, shapeEmployee(result));
});

router.get("/field-employees/:id", async (req, res): Promise<void> => {
  const params = GetFieldEmployeeParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }

  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  const includeDeleted = session.role === "admin";
  const conds = [
    eq(fieldEmployeesTable.id, params.data.id),
    inArray(fieldEmployeesTable.vendorRole, ["field", "both", "foreman"]),
  ];
  if (!includeDeleted) conds.push(isNull(fieldEmployeesTable.deletedAt));

  const [result] = await db
    .select(baseSelect)
    .from(fieldEmployeesTable)
    .leftJoin(vendorsTable, eq(fieldEmployeesTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(fieldEmployeesTable.userId, usersTable.id))
    .where(and(...conds));

  if (!result) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }

  // Vendors may only view their own employees; return 404 to avoid leaking existence
  if (session.role === "vendor" && result.vendorId !== session.vendorId) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }

  sendResponse(res, GetFieldEmployeeResponse, shapeEmployee(result));
});

router.delete("/field-employees/:id", async (req, res): Promise<void> => {
  const params = UpdateFieldEmployeeParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({ error: "Admin or vendor login required" });
    return;
  }
  if (session.role === "vendor" && session.membershipRole !== "admin") {
    res.status(403).json({ error: "Vendor admin access required" });
    return;
  }
  const [target] = await db
    .select({ vendorId: fieldEmployeesTable.vendorId })
    .from(fieldEmployeesTable)
    .where(and(
      eq(fieldEmployeesTable.id, params.data.id),
      inArray(fieldEmployeesTable.vendorRole, ["field", "both", "foreman"]),
      isNull(fieldEmployeesTable.deletedAt),
    ));
  if (!target) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== target.vendorId) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  const [deleted] = await db
    .update(fieldEmployeesTable)
    .set({ deletedAt: sql`now()`, deletedBy: `${session.role}:${session.userId}`, isActive: false })
    .where(eq(fieldEmployeesTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  // Task #876: surface any open ticket sessions for this worker so the
  // office UI can tell staff which foremen will see this row drop on
  // their next mobile refresh (Task #524 made the field side handle
  // mid-shift deactivations gracefully on a 60s cadence). The lookup
  // mirrors the open-session pattern used by the crew check-in /
  // check-out routes (see crew.ts) — an open session is one without
  // a checkOutAt stamp.
  const openSessionRows = await db
    .select({
      ticketId: ticketCheckInsTable.ticketId,
      checkInAt: ticketCheckInsTable.checkInAt,
    })
    .from(ticketCheckInsTable)
    .innerJoin(ticketsTable, eq(ticketCheckInsTable.ticketId, ticketsTable.id))
    .where(and(
      eq(ticketCheckInsTable.employeeId, params.data.id),
      isNull(ticketCheckInsTable.checkOutAt),
    ));
  const openSessions = openSessionRows.map((s) => ({
    ticketId: s.ticketId,
    ticketTrackingNumber: formatTicketTrackingNumber(s.ticketId),
    checkInAt: (s.checkInAt instanceof Date ? s.checkInAt : new Date(s.checkInAt as any)).toISOString(),
  }));
  res.status(200).json({ openSessions });
});

router.post("/field-employees/:id/restore", async (req, res): Promise<void> => {
  const params = UpdateFieldEmployeeParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    res.status(401).json({ error: "Admin login required" });
    return;
  }
  const [restored] = await db
    .update(fieldEmployeesTable)
    .set({ deletedAt: null, deletedBy: null, isActive: true })
    .where(and(
      eq(fieldEmployeesTable.id, params.data.id),
      inArray(fieldEmployeesTable.vendorRole, ["field", "both", "foreman"]),
    ))
    .returning();
  if (!restored) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  res.status(204).send();
});

router.patch("/field-employees/:id", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  if (session.role === "vendor" && session.membershipRole !== "admin") {
    res.status(403).json({ error: "Vendor admin access required" });
    return;
  }

  const params = UpdateFieldEmployeeParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  const parsed = UpdateFieldEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }

  // Verify the employee exists and enforce tenant isolation for vendors
  const [target] = await db
    .select({ vendorId: fieldEmployeesTable.vendorId })
    .from(fieldEmployeesTable)
    .where(and(
      eq(fieldEmployeesTable.id, params.data.id),
      inArray(fieldEmployeesTable.vendorRole, ["field", "both", "foreman"]),
      isNull(fieldEmployeesTable.deletedAt),
    ));
  if (!target) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== target.vendorId) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }

  const updateData = { ...parsed.data };
  if (updateData.pecExpirationDate !== undefined) {
    if (updateData.pecExpirationDate) {
      const expDate = new Date(updateData.pecExpirationDate + "T00:00:00");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      updateData.pecCertification = expDate.getTime() >= today.getTime();
    } else {
      updateData.pecCertification = false;
    }
  }
  const [updated] = await db
    .update(fieldEmployeesTable)
    .set(updateData)
    .where(and(
      eq(fieldEmployeesTable.id, params.data.id),
      inArray(fieldEmployeesTable.vendorRole, ["field", "both", "foreman"]),
    ))
    .returning();
  // Task #831: keep `users.preferred_language` in sync with the
  // vendor_people row whenever an admin/vendor explicitly changes the
  // preferred language. The token-mode assistant keys off the
  // vendor_people column (no users row yet), but post-auth assistant
  // turns key off `users.preferred_language`, so a one-sided update
  // would let the two columns drift. We only mirror when the field was
  // actually present in the request body — undefined means "leave as
  // is" — and only when there's a linked login to mirror into.
  if (updated && updated.userId !== null && parsed.data.preferredLanguage !== undefined) {
    await db
      .update(usersTable)
      .set({ preferredLanguage: parsed.data.preferredLanguage ?? null })
      .where(eq(usersTable.id, updated.userId));
  }
  if (!updated) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }

  const [result] = await db
    .select(baseSelect)
    .from(fieldEmployeesTable)
    .leftJoin(vendorsTable, eq(fieldEmployeesTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(fieldEmployeesTable.userId, usersTable.id))
    .where(eq(fieldEmployeesTable.id, params.data.id));

  // Task #583: PATCH originally returned the row without running it
  // through shapeEmployee, which left `hasLogin` / `mustChangePassword`
  // unset. Both fields are optional in the response schema, but the
  // dashboard relies on `hasLogin` to decide whether to render the
  // "send invite" button on the just-edited row, so we now derive it
  // here too. The query above is also extended with a leftJoin on
  // usersTable so the suspendedAt / mustChangePasswordRaw columns
  // referenced by baseSelect actually resolve. The join is LEFT
  // because users.field_employee_id is nullable (employees without a
  // login never get a users row).
  sendResponse(res, GetFieldEmployeeResponse, shapeEmployee(result));
});

router.get("/field-employees/:employeeId/notes", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  const params = ListFieldEmployeeNotesParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  const [target] = await db
    .select({ id: fieldEmployeesTable.id, vendorId: fieldEmployeesTable.vendorId })
    .from(fieldEmployeesTable)
    .where(and(
      eq(fieldEmployeesTable.id, params.data.employeeId),
      inArray(fieldEmployeesTable.vendorRole, ["field", "both", "foreman"]),
      isNull(fieldEmployeesTable.deletedAt),
    ));
  if (!target) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== target.vendorId) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  const notes = await db
    .select()
    .from(fieldEmployeeNotesTable)
    .where(eq(fieldEmployeeNotesTable.employeeId, params.data.employeeId))
    .orderBy(fieldEmployeeNotesTable.createdAt);
  sendResponse(res, ListFieldEmployeeNotesResponse, notes);
});

router.post("/field-employees/:employeeId/notes", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  const params = CreateFieldEmployeeNoteParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  const parsed = CreateFieldEmployeeNoteBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }
  const [target] = await db
    .select({ id: fieldEmployeesTable.id, vendorId: fieldEmployeesTable.vendorId })
    .from(fieldEmployeesTable)
    .where(and(
      eq(fieldEmployeesTable.id, params.data.employeeId),
      inArray(fieldEmployeesTable.vendorRole, ["field", "both", "foreman"]),
      isNull(fieldEmployeesTable.deletedAt),
    ));
  if (!target) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== target.vendorId) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  const [note] = await db
    .insert(fieldEmployeeNotesTable)
    .values({ ...parsed.data, employeeId: params.data.employeeId })
    .returning();
  res.status(201).json(note);
});

router.delete("/field-employees/:employeeId/notes/:noteId", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  const params = DeleteFieldEmployeeNoteParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }

  // Verify the employee exists (non-deleted) and the note belongs to that employee
  const [target] = await db
    .select({ vendorId: fieldEmployeesTable.vendorId })
    .from(fieldEmployeesTable)
    .where(and(
      eq(fieldEmployeesTable.id, params.data.employeeId),
      inArray(fieldEmployeesTable.vendorRole, ["field", "both", "foreman"]),
      isNull(fieldEmployeesTable.deletedAt),
    ));
  if (!target) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== target.vendorId) {
    res.status(404).json({ error: "Field employee not found" });
    return;
  }

  const [deleted] = await db
    .delete(fieldEmployeeNotesTable)
    .where(and(
      eq(fieldEmployeeNotesTable.id, params.data.noteId),
      eq(fieldEmployeeNotesTable.employeeId, params.data.employeeId),
    ))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
