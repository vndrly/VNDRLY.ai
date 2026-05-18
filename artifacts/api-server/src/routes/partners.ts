import { Router, type IRouter } from "express";
import { eq, inArray, sql, and, isNull } from "drizzle-orm";
import { db, partnersTable, partnerContactsTable, partnerNotesTable, siteLocationsTable, siteWorkAssignmentsTable, ticketsTable } from "@workspace/db";
import crypto from "crypto";
import { SESSION_SECRET } from "../lib/session";
import { findNameMatches } from "../lib/name-match";
import { sendResponse, sendResponseStatus } from "../lib/typed-response";

import { sendValidationFailed } from "../lib/validation-error";
const COOKIE_NAME = "vndrly_session";

function getSessionFromRequest(req: any): { role: string; userId?: number; vendorId: number | null; partnerId: number | null; membershipRole?: string | null } | null {
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
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    const obj = JSON.parse(decoded);
    const now = Math.floor(Date.now() / 1000);
    if (!obj || typeof obj.exp !== "number" || obj.exp < now) return null;
    return obj;
  } catch { return null; }
}

async function vendorHasPartnerRelationship(vendorId: number, partnerId: number): Promise<boolean> {
  const fromAssignments = await db
    .select({ partnerId: siteLocationsTable.partnerId })
    .from(siteWorkAssignmentsTable)
    .innerJoin(siteLocationsTable, eq(siteWorkAssignmentsTable.siteLocationId, siteLocationsTable.id))
    .where(and(eq(siteWorkAssignmentsTable.vendorId, vendorId), eq(siteLocationsTable.partnerId, partnerId)))
    .limit(1);
  if (fromAssignments.length > 0) return true;
  const fromTickets = await db
    .select({ partnerId: siteLocationsTable.partnerId })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(and(eq(ticketsTable.vendorId, vendorId), eq(siteLocationsTable.partnerId, partnerId)))
    .limit(1);
  return fromTickets.length > 0;
}
import {
  CreatePartnerBody,
  GetPartnerParams,
  GetPartnerResponse,
  UpdatePartnerParams,
  UpdatePartnerBody,
  UpdatePartnerResponse,
  ListPartnersResponse,
  ListPartnerContactsParams,
  ListPartnerContactsResponse,
  CreatePartnerContactParams,
  CreatePartnerContactBody,
  UpdatePartnerContactParams,
  UpdatePartnerContactBody,
  DeletePartnerContactParams,
  ListPartnerNotesParams,
  ListPartnerNotesResponse,
  CreatePartnerNoteParams,
  CreatePartnerNoteBody,
  DeletePartnerNoteParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/partners", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }

  if (session.role === "vendor") {
    const vendorId = session.vendorId;
    if (!vendorId) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const partnerIdsFromAssignments = db
      .select({ partnerId: siteLocationsTable.partnerId })
      .from(siteWorkAssignmentsTable)
      .innerJoin(siteLocationsTable, eq(siteWorkAssignmentsTable.siteLocationId, siteLocationsTable.id))
      .where(eq(siteWorkAssignmentsTable.vendorId, vendorId));

    const partnerIdsFromTickets = db
      .select({ partnerId: siteLocationsTable.partnerId })
      .from(ticketsTable)
      .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
      .where(eq(ticketsTable.vendorId, vendorId));

    const partners = await db
      .select()
      .from(partnersTable)
      .where(
        sql`${partnersTable.id} IN (${partnerIdsFromAssignments}) OR ${partnersTable.id} IN (${partnerIdsFromTickets})`
      )
      .orderBy(partnersTable.createdAt);

    sendResponse(res, ListPartnersResponse, partners);
    return;
  }

  if (session.role === "partner") {
    if (!session.partnerId) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const partners = await db
      .select()
      .from(partnersTable)
      .where(eq(partnersTable.id, session.partnerId))
      .orderBy(partnersTable.createdAt);
    sendResponse(res, ListPartnersResponse, partners);
    return;
  }

  if (session.role !== "admin") {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }

  const partners = await db.select().from(partnersTable).orderBy(partnersTable.createdAt);
  sendResponse(res, ListPartnersResponse, partners);
});

router.post("/partners", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  const parsed = CreatePartnerBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const [partner] = await db.insert(partnersTable).values(parsed.data).returning();
  sendResponseStatus(res, 201, GetPartnerResponse, partner);
});

// Must be declared before GET /partners/:id so "match" isn't parsed as an id.
// Mirrors /vendors/match — returns the closest existing partners by
// fuzzy similarity so the new-partner form can warn admins before
// they create a near-duplicate (e.g. "ConocoPhillips Permian" when
// "ConocoPhillips" already exists).
router.get("/partners/match", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  const nameRaw = req.query.name;
  if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) {
    res.json({ matches: [] });
    return;
  }
  const all = await db
    .select({ id: partnersTable.id, name: partnersTable.name })
    .from(partnersTable);
  const matches = findNameMatches(nameRaw, all);
  res.json({
    matches: matches.map((m) => ({
      id: m.id,
      name: m.name,
      score: Math.round(m.score * 1000) / 1000,
    })),
  });
});

// Public counterpart of /partners/match for the unauthenticated partner
// self-signup flow on the web (signup-partner.tsx). Mirrors
// /vendors/check-name: returns only name+score (no IDs or other PII)
// so the public form can warn a partner that their company already
// has an account before they create a duplicate. No auth required.
router.get("/partners/check-name", async (req, res): Promise<void> => {
  const nameRaw = req.query.name;
  if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) {
    res.json({ matches: [] });
    return;
  }
  const all = await db
    .select({ id: partnersTable.id, name: partnersTable.name })
    .from(partnersTable);
  const matches = findNameMatches(nameRaw, all);
  res.json({
    matches: matches.map((m) => ({
      name: m.name,
      score: Math.round(m.score * 1000) / 1000,
    })),
  });
});

router.get("/partners/:id", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = GetPartnerParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "partner" && session.partnerId !== params.data.id) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role === "vendor") {
    if (!session.vendorId) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const related = await vendorHasPartnerRelationship(session.vendorId, params.data.id);
    if (!related) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
  }
  if (session.role !== "admin" && session.role !== "partner" && session.role !== "vendor") {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, params.data.id));
  if (!partner) {
    res.status(404).json({ error: "Partner not found", code: "partner.not_found" });
    return;
  }
  sendResponse(res, GetPartnerResponse, partner);
});

router.delete("/partners/:id", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  const params = GetPartnerParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const [deleted] = await db.delete(partnersTable).where(eq(partnersTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Partner not found", code: "partner.not_found" });
    return;
  }
  res.status(204).send();
});

router.patch("/partners/:id", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = UpdatePartnerParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "partner" && session.partnerId !== params.data.id) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Admin or partner access required", code: "auth.admin_or_partner_required" });
    return;
  }
  if (session.role === "partner" && session.membershipRole !== "admin") {
    res.status(403).json({ error: "Partner admin access required", code: "auth.partner_admin_required" });
    return;
  }
  const parsed = UpdatePartnerBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  // Pre-check for an exact case/whitespace duplicate of another
  // partner's name. The DB has a unique index on `lower(btrim(name))`
  // (`partners_canonical_name_unique`) and without this guard a
  // colliding PATCH falls through to the catch below, which still
  // returns 409 — but doing the lookup up-front lets us include the
  // conflicting partner's id in the response so the Edit dialog can
  // link the admin straight to the existing record. The fuzzy
  // duplicate-warning UI in partner-detail.tsx already catches near
  // matches before submit; this guard only fires for exact canonical
  // collisions that slip past it (e.g. "  acme " vs "Acme").
  if (typeof parsed.data.name === "string" && parsed.data.name.trim().length > 0) {
    const canonical = parsed.data.name.trim().toLowerCase();
    const [conflict] = await db
      .select({ id: partnersTable.id, name: partnersTable.name })
      .from(partnersTable)
      .where(
        and(
          sql`lower(btrim(${partnersTable.name})) = ${canonical}`,
          sql`${partnersTable.id} <> ${params.data.id}`,
        ),
      )
      .limit(1);
    if (conflict) {
      res.status(409).json({
        error: `A partner named "${conflict.name}" already exists.`,
        code: "partner.duplicate_name",
        existingPartner: { id: conflict.id, name: conflict.name },
        // Forwarded as i18next interpolation values by the web
        // client's translateApiError helper so EN/ES copy can render
        // `{{name}}` instead of the bare generic string.
        details: { name: conflict.name },
      });
      return;
    }
  }
  let partner;
  try {
    [partner] = await db.update(partnersTable).set(parsed.data).where(eq(partnersTable.id, params.data.id)).returning();
  } catch (err) {
    // Race-condition fallback: a concurrent insert/rename slipped past
    // the pre-check above and the DB unique index
    // (`partners_canonical_name_unique` on `lower(btrim(name))`)
    // caught it. Translate the Postgres unique violation into the
    // same 409 shape the pre-check returns so the client sees a
    // consistent error instead of a generic 500.
    const cause = (err as { cause?: { code?: string; constraint?: string } })
      .cause;
    if (
      cause?.code === "23505" &&
      cause?.constraint === "partners_canonical_name_unique" &&
      typeof parsed.data.name === "string"
    ) {
      const [existing] = await db
        .select({ id: partnersTable.id, name: partnersTable.name })
        .from(partnersTable)
        .where(
          sql`lower(btrim(${partnersTable.name})) = lower(btrim(${parsed.data.name}))`,
        )
        .limit(1);
      const conflictName = existing?.name ?? parsed.data.name;
      res.status(409).json({
        error: `A partner named "${conflictName}" already exists.`,
        code: "partner.duplicate_name",
        existingPartner: existing
          ? { id: existing.id, name: existing.name }
          : undefined,
        details: { name: conflictName },
      });
      return;
    }
    throw err;
  }
  if (!partner) {
    res.status(404).json({ error: "Partner not found", code: "partner.not_found" });
    return;
  }
  sendResponse(res, UpdatePartnerResponse, partner);
});

router.get("/partners/:partnerId/contacts", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = ListPartnerContactsParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "partner" && session.partnerId !== params.data.partnerId) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role === "vendor") {
    if (!session.vendorId) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const related = await vendorHasPartnerRelationship(session.vendorId, params.data.partnerId);
    if (!related) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
  }
  if (session.role !== "admin" && session.role !== "partner" && session.role !== "vendor") {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  const includeDeleted = session.role === "admin" && (req.query.includeDeleted === "true" || req.query.includeDeleted === "1");
  const conds = [eq(partnerContactsTable.partnerId, params.data.partnerId)];
  if (!includeDeleted) conds.push(isNull(partnerContactsTable.deletedAt));
  const contacts = await db
    .select()
    .from(partnerContactsTable)
    .where(and(...conds))
    .orderBy(partnerContactsTable.createdAt);
  sendResponse(res, ListPartnerContactsResponse, contacts);
});

router.post("/partners/:partnerId/contacts", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = CreatePartnerContactParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "partner" && session.partnerId !== params.data.partnerId) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Admin or partner access required", code: "auth.admin_or_partner_required" });
    return;
  }
  const parsed = CreatePartnerContactBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const [contact] = await db
    .insert(partnerContactsTable)
    .values({ ...parsed.data, partnerId: params.data.partnerId })
    .returning();
  res.status(201).json(contact);
});

router.patch("/partners/:partnerId/contacts/:contactId", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = UpdatePartnerContactParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "partner" && session.partnerId !== params.data.partnerId) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Admin or partner access required", code: "auth.admin_or_partner_required" });
    return;
  }
  const parsed = UpdatePartnerContactBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const [contact] = await db
    .update(partnerContactsTable)
    .set(parsed.data)
    .where(and(eq(partnerContactsTable.id, params.data.contactId), eq(partnerContactsTable.partnerId, params.data.partnerId)))
    .returning();
  if (!contact) {
    res.status(404).json({ error: "Contact not found", code: "contact.not_found" });
    return;
  }
  res.json(contact);
});

router.delete("/partners/:partnerId/contacts/:contactId", async (req, res): Promise<void> => {
  const params = DeletePartnerContactParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const session = getSessionFromRequest(req);
  if (!session || !["admin", "partner"].includes(session.role)) {
    res.status(401).json({ error: "Admin or partner login required", code: "auth.admin_or_partner_login_required" });
    return;
  }
  if (session.role === "partner" && session.partnerId !== params.data.partnerId) {
    res.status(403).json({ error: "Not allowed", code: "auth.not_allowed" });
    return;
  }
  const [deleted] = await db
    .update(partnerContactsTable)
    .set({ deletedAt: sql`now()`, deletedBy: `${session.role}:${(session as any).userId ?? ""}` })
    .where(and(
      eq(partnerContactsTable.id, params.data.contactId),
      eq(partnerContactsTable.partnerId, params.data.partnerId),
      isNull(partnerContactsTable.deletedAt),
    ))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Contact not found", code: "contact.not_found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/partners/:partnerId/contacts/:contactId/restore", async (req, res): Promise<void> => {
  const params = DeletePartnerContactParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const session = getSessionFromRequest(req);
  if (!session || session.role !== "admin") {
    res.status(401).json({ error: "Admin login required", code: "auth.admin_login_required" });
    return;
  }
  const [restored] = await db
    .update(partnerContactsTable)
    .set({ deletedAt: null, deletedBy: null })
    .where(and(
      eq(partnerContactsTable.id, params.data.contactId),
      eq(partnerContactsTable.partnerId, params.data.partnerId),
    ))
    .returning();
  if (!restored) {
    res.status(404).json({ error: "Contact not found", code: "contact.not_found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/partners/:partnerId/notes", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = ListPartnerNotesParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "partner" && session.partnerId !== params.data.partnerId) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Admin or partner access required", code: "auth.admin_or_partner_required" });
    return;
  }
  const notes = await db
    .select()
    .from(partnerNotesTable)
    .where(eq(partnerNotesTable.partnerId, params.data.partnerId))
    .orderBy(partnerNotesTable.createdAt);
  sendResponse(res, ListPartnerNotesResponse, notes);
});

router.post("/partners/:partnerId/notes", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = CreatePartnerNoteParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "partner" && session.partnerId !== params.data.partnerId) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Admin or partner access required", code: "auth.admin_or_partner_required" });
    return;
  }
  const parsed = CreatePartnerNoteBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const [note] = await db
    .insert(partnerNotesTable)
    .values({ ...parsed.data, partnerId: params.data.partnerId })
    .returning();
  res.status(201).json(note);
});

router.delete("/partners/:partnerId/notes/:noteId", async (req, res): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = DeletePartnerNoteParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "partner" && session.partnerId !== params.data.partnerId) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Admin or partner access required", code: "auth.admin_or_partner_required" });
    return;
  }
  const [deleted] = await db
    .delete(partnerNotesTable)
    .where(and(
      eq(partnerNotesTable.id, params.data.noteId),
      eq(partnerNotesTable.partnerId, params.data.partnerId),
    ))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Note not found", code: "note.not_found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
