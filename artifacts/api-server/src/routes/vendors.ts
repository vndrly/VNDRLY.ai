import { Router, type IRouter } from "express";
import { eq, and, notInArray, isNull, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, vendorsTable, vendorContactsTable, vendorNotesTable, fieldEmployeesTable, partnerVendorRelationshipsTable, usersTable } from "@workspace/db";
import { SESSION_SECRET } from "../lib/session";
import { findVendorMatches, normalizeVendorName } from "../lib/vendor-match";
import {
  assertCanManageVendorPeople,
  isForemanActor,
  validateVendorRoleAssignment,
} from "../lib/vendor-people-management";

const COOKIE_NAME = "vndrly_session";
type Session = {
  userId: number;
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  membershipRole?: string | null;
  vendorRole?: string | null;
  vendorPeopleId?: number | null;
};
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
  CreateVendorBody,
  GetVendorParams,
  GetVendorResponse,
  UpdateVendorParams,
  UpdateVendorBody,
  UpdateVendorResponse,
  ListVendorsResponse,
  ListVendorContactsParams,
  ListVendorContactsResponse,
  CreateVendorContactParams,
  CreateVendorContactBody,
  UpdateVendorContactParams,
  UpdateVendorContactBody,
  DeleteVendorContactParams,
  ListVendorNotesParams,
  ListVendorNotesResponse,
  CreateVendorNoteParams,
  CreateVendorNoteBody,
  DeleteVendorNoteParams,
} from "@workspace/api-zod";
import { sendResponse, sendResponseStatus } from "../lib/typed-response";

import { sendValidationFailed } from "../lib/validation-error";
const router: IRouter = Router();

async function partnerHasVendorRelationship(partnerId: number, vendorId: number): Promise<boolean> {
  const [rel] = await db
    .select({ id: partnerVendorRelationshipsTable.id })
    .from(partnerVendorRelationshipsTable)
    .where(
      and(
        eq(partnerVendorRelationshipsTable.partnerId, partnerId),
        eq(partnerVendorRelationshipsTable.vendorId, vendorId),
      ),
    )
    .limit(1);
  return !!rel;
}

router.get("/vendors", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role === "partner") {
    if (!session.partnerId) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const vendors = await db
      .select({ vendor: vendorsTable })
      .from(vendorsTable)
      .innerJoin(
        partnerVendorRelationshipsTable,
        and(
          eq(partnerVendorRelationshipsTable.vendorId, vendorsTable.id),
          eq(partnerVendorRelationshipsTable.partnerId, session.partnerId),
        ),
      )
      .orderBy(vendorsTable.createdAt);
    sendResponse(res, ListVendorsResponse, vendors.map((r) => r.vendor));
    return;
  }
  const vendors = await db.select().from(vendorsTable).orderBy(vendorsTable.createdAt);
  sendResponse(res, ListVendorsResponse, vendors);
});

router.post("/vendors", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  const parsed = CreateVendorBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  // Server-side guard against exact-name duplicates. The web form runs a
  // fuzzy lookup and warns the admin, but direct API calls / older
  // clients can still POST a duplicate, so block it here too.
  //
  // We use the same `normalizeVendorName` the duplicate-warning UI uses
  // (NFKD-folded, lowercased, punctuation stripped, generic corporate
  // suffixes dropped) so "Acme Inc.", "ACME, LLC" and "  acme  " all
  // collapse to the same canonical form. The DB has a separate unique
  // index on `lower(btrim(name))` that catches case/whitespace dupes;
  // this check is intentionally stricter and runs first so we can return
  // a friendly 409 with the conflicting row instead of a generic 500
  // from the unique-violation.
  const normalizedNew = normalizeVendorName(parsed.data.name);
  if (normalizedNew) {
    const existing = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable);
    const conflict = existing.find(
      (v) => normalizeVendorName(v.name) === normalizedNew,
    );
    if (conflict) {
      res.status(409).json({
        error: `A vendor named "${conflict.name}" already exists.`,
        code: "vendor.duplicate_name",
        existingVendor: { id: conflict.id, name: conflict.name },
        // `details` is forwarded as i18next interpolation values by the
        // web client's translateApiError helper, so the Spanish/English
        // copy can render the conflicting name (e.g. "{{name}}") instead
        // of the bare generic "A vendor with that name already exists."
        details: { name: conflict.name },
      });
      return;
    }
  }
  try {
    const [vendor] = await db.insert(vendorsTable).values(parsed.data).returning();
    sendResponseStatus(res, 201, GetVendorResponse, vendor);
  } catch (err) {
    // Race-condition fallback: a concurrent insert slipped past the
    // pre-check and the DB unique index (`vendors_canonical_name_unique`
    // on `lower(btrim(name))`) caught it. Translate the Postgres unique
    // violation into the same 409 shape so the client sees a consistent
    // error.
    const cause = (err as { cause?: { code?: string; constraint?: string } })
      .cause;
    if (
      cause?.code === "23505" &&
      cause?.constraint === "vendors_canonical_name_unique"
    ) {
      // Look up the persisted row so the client sees the actual stored
      // name (preserved casing/punctuation) rather than the raw text the
      // racing caller submitted, which is consistent with the pre-check
      // path above.
      const [existing] = await db
        .select({ name: vendorsTable.name })
        .from(vendorsTable)
        .where(
          sql`lower(btrim(${vendorsTable.name})) = lower(btrim(${parsed.data.name}))`,
        )
        .limit(1);
      const conflictName = existing?.name ?? parsed.data.name;
      res.status(409).json({
        error: `A vendor named "${conflictName}" already exists.`,
        code: "vendor.duplicate_name",
        details: { name: conflictName },
      });
      return;
    }
    throw err;
  }
});

// Must be declared before GET /vendors/:id so "match" isn't parsed as an id.
router.get("/vendors/match", async (req, res): Promise<void> => {
  const session = getSession(req);
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
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable);
  const matches = findVendorMatches(nameRaw, all);
  res.json({
    matches: matches.map((m) => ({
      id: m.id,
      name: m.name,
      score: Math.round(m.score * 1000) / 1000,
    })),
  });
});

// Public counterpart of /vendors/match for the unauthenticated mobile
// signup flow. Returns name+score only (no IDs/PII).
router.get("/vendors/check-name", async (req, res): Promise<void> => {
  const nameRaw = req.query.name;
  if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) {
    res.json({ matches: [] });
    return;
  }
  const all = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable);
  const matches = findVendorMatches(nameRaw, all);
  res.json({
    matches: matches.map((m) => ({
      name: m.name,
      score: Math.round(m.score * 1000) / 1000,
    })),
  });
});

router.get("/vendors/:id", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = GetVendorParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (
    session.role !== "admin" &&
    session.role !== "partner" &&
    session.role !== "vendor" &&
    session.role !== "field_employee"
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  // Vendor admins/members and field employees can only read their own
  // vendor record. The mobile app's BrandProvider hits this endpoint to
  // hydrate org branding (color, logo, square logo) on every login —
  // without this, field employees on a vendor with branding configured
  // see the default amber + VNDRLY logo instead of their employer's
  // chrome.
  if (
    (session.role === "vendor" || session.role === "field_employee") &&
    session.vendorId !== params.data.id
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role === "partner") {
    if (!session.partnerId || !(await partnerHasVendorRelationship(session.partnerId, params.data.id))) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
  }
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, params.data.id));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found", code: "vendor.not_found" });
    return;
  }
  sendResponse(res, GetVendorResponse, vendor);
});

router.patch("/vendors/:id", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = UpdateVendorParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== params.data.id) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role !== "admin" && session.role !== "vendor") {
    res.status(403).json({ error: "Admin or vendor access required", code: "auth.admin_or_vendor_required" });
    return;
  }
  if (session.role === "vendor" && session.membershipRole !== "admin") {
    res.status(403).json({ error: "Vendor admin access required", code: "auth.vendor_admin_required" });
    return;
  }
  const parsed = UpdateVendorBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  // Mirror the POST /vendors duplicate-name guard for renames. Without
  // this, an admin can edit "Acme" → "Acme Inc." and end up with two
  // rows that canonicalize to the same form — exactly what the POST
  // guard was added to prevent. We use the same `normalizeVendorName`
  // helper (NFKD-folded, lowercased, punctuation stripped, generic
  // corporate suffixes dropped) so casing/punctuation/suffix-only
  // changes against any *other* vendor are rejected with a friendly
  // 409. The DB unique index on `lower(btrim(name))` only catches
  // exact case/whitespace dupes, so this stricter pre-check runs
  // first.
  if (typeof parsed.data.name === "string") {
    const normalizedNew = normalizeVendorName(parsed.data.name);
    if (normalizedNew) {
      const others = await db
        .select({ id: vendorsTable.id, name: vendorsTable.name })
        .from(vendorsTable);
      const conflict = others.find(
        (v) =>
          v.id !== params.data.id &&
          normalizeVendorName(v.name) === normalizedNew,
      );
      if (conflict) {
        res.status(409).json({
          error: `A vendor named "${conflict.name}" already exists.`,
          code: "vendor.duplicate_name",
          existingVendor: { id: conflict.id, name: conflict.name },
          // Forwarded as i18next interpolation values by the web
          // client's translateApiError helper so EN/ES copy can render
          // `{{name}}` instead of the bare generic string.
          details: { name: conflict.name },
        });
        return;
      }
    }
  }
  let vendor;
  try {
    [vendor] = await db
      .update(vendorsTable)
      .set(parsed.data)
      .where(eq(vendorsTable.id, params.data.id))
      .returning();
  } catch (err) {
    // Race-condition fallback: a concurrent insert/rename slipped past
    // the pre-check and the DB unique index
    // (`vendors_canonical_name_unique` on `lower(btrim(name))`) caught
    // it. Translate the Postgres unique violation into the same 409
    // shape the pre-check returns so the client sees a consistent
    // error.
    const cause = (err as { cause?: { code?: string; constraint?: string } })
      .cause;
    if (
      cause?.code === "23505" &&
      cause?.constraint === "vendors_canonical_name_unique" &&
      typeof parsed.data.name === "string"
    ) {
      const [existing] = await db
        .select({ id: vendorsTable.id, name: vendorsTable.name })
        .from(vendorsTable)
        .where(
          sql`lower(btrim(${vendorsTable.name})) = lower(btrim(${parsed.data.name}))`,
        )
        .limit(1);
      const conflictName = existing?.name ?? parsed.data.name;
      res.status(409).json({
        error: `A vendor named "${conflictName}" already exists.`,
        code: "vendor.duplicate_name",
        existingVendor: existing
          ? { id: existing.id, name: existing.name }
          : undefined,
        details: { name: conflictName },
      });
      return;
    }
    throw err;
  }
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found", code: "vendor.not_found" });
    return;
  }
  // Task #1156 — re-derive every partner relationship after a vendor
  // mutation. A compliance-doc URL or expiration-date edit might
  // unblock or trip a `auto_unapproved` lapse, and the engine is the
  // single source of truth for that decision. Fire-and-forget so the
  // PATCH response stays fast; the engine is idempotent.
  void (async () => {
    try {
      const { recomputeAllForVendor } = await import(
        "../lib/approval-derivation"
      );
      await recomputeAllForVendor(params.data.id, {
        triggerReason: "vendor_compliance_updated",
        actorUserId: session.userId ?? null,
        actorRole: session.role ?? null,
      });
    } catch {
      /* best-effort; cron will catch anything missed */
    }
  })();
  sendResponse(res, UpdateVendorResponse, vendor);
});

// ──────────────────────────────────────────────────────────────────
// E-delivery consent for 1099 statements (per IRS Pub 1179 / Reg 31.6051-1)
// ──────────────────────────────────────────────────────────────────
//
// The IRS allows electronic delivery of payee statements only with the
// recipient's *affirmative* consent — and that consent must be made
// "in a manner that demonstrates the recipient can access the
// statement in the electronic format". We track three fields:
//   - consent (bool): has the vendor agreed to electronic delivery?
//   - consentAt: when consent was recorded (audit trail)
//   - consentEmail: the address consent was given for (so changing
//                   primary email later doesn't silently re-target).
// Withdrawing consent is just POSTing { consent: false }.

router.get(
  "/vendors/:vendorId/e-delivery-consent",
  async (req, res): Promise<void> => {
    const id = Number(req.params.vendorId);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    if (
      session.role !== "admin" &&
      !(session.role === "vendor" && session.vendorId === id)
    ) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const [v] = await db
      .select({
        eDeliveryConsent: vendorsTable.eDeliveryConsent,
        eDeliveryConsentAt: vendorsTable.eDeliveryConsentAt,
        eDeliveryEmail: vendorsTable.eDeliveryEmail,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, id));
    if (!v) {
      res.status(404).json({ error: "Vendor not found", code: "vendor.not_found" });
      return;
    }
    res.json({
      consent: v.eDeliveryConsent,
      consentAt: v.eDeliveryConsentAt?.toISOString() ?? null,
      consentEmail: v.eDeliveryEmail,
    });
  },
);

router.post(
  "/vendors/:vendorId/e-delivery-consent",
  async (req, res): Promise<void> => {
    const id = Number(req.params.vendorId);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad vendorId", code: "vendor.invalid_id" });
      return;
    }
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    // Only the vendor themself or an admin can record consent. Partners
    // cannot consent on a vendor's behalf.
    if (
      session.role !== "admin" &&
      !(session.role === "vendor" && session.vendorId === id)
    ) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const body = req.body ?? {};
    const consent = body.consent === true;
    const email =
      typeof body.email === "string" && body.email.trim().length > 0
        ? body.email.trim()
        : null;
    if (consent && !email) {
      res.status(400).json({
        error: "Email is required when granting consent (IRS requires the address the statement will be delivered to).", code: "vendor.consent_email_required",
      });
      return;
    }
    const patch = consent
      ? {
          eDeliveryConsent: true,
          eDeliveryConsentAt: new Date(),
          eDeliveryEmail: email,
        }
      : {
          eDeliveryConsent: false,
          eDeliveryConsentAt: new Date(),
          eDeliveryEmail: null,
        };
    const [v] = await db
      .update(vendorsTable)
      .set(patch)
      .where(eq(vendorsTable.id, id))
      .returning({
        eDeliveryConsent: vendorsTable.eDeliveryConsent,
        eDeliveryConsentAt: vendorsTable.eDeliveryConsentAt,
        eDeliveryEmail: vendorsTable.eDeliveryEmail,
      });
    if (!v) {
      res.status(404).json({ error: "Vendor not found", code: "vendor.not_found" });
      return;
    }
    res.json({
      consent: v.eDeliveryConsent,
      consentAt: v.eDeliveryConsentAt?.toISOString() ?? null,
      consentEmail: v.eDeliveryEmail,
    });
  },
);

router.delete("/vendors/:id", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  const params = GetVendorParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const [deleted] = await db.delete(vendorsTable).where(eq(vendorsTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Vendor not found", code: "vendor.not_found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/vendor-contacts", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (
    session.role !== "admin" &&
    session.role !== "partner" &&
    session.role !== "vendor" &&
    !isForemanActor(session)
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  let vendorId: number | null;
  if (session.role === "vendor" || isForemanActor(session)) {
    if (!session.vendorId) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    vendorId = session.vendorId;
  } else if (session.role === "partner") {
    if (!session.partnerId) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const vendorIdParam = req.query.vendorId;
    vendorId = vendorIdParam ? Number(vendorIdParam) : null;
    if (vendorId) {
      if (!(await partnerHasVendorRelationship(session.partnerId, vendorId))) {
        res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
        return;
      }
    }
  } else {
    const vendorIdParam = req.query.vendorId;
    vendorId = vendorIdParam ? Number(vendorIdParam) : null;
  }
  const includeDeleted = session.role === "admin" && (req.query.includeDeleted === "true" || req.query.includeDeleted === "1");
  const baseSelect = {
    id: fieldEmployeesTable.id,
    vendorId: fieldEmployeesTable.vendorId,
    vendorRole: fieldEmployeesTable.vendorRole,
    roles: fieldEmployeesTable.roles,
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
    profilePendingReviewAt: fieldEmployeesTable.profilePendingReviewAt,
    createdAt: fieldEmployeesTable.createdAt,
    deletedAt: fieldEmployeesTable.deletedAt,
    deletedBy: fieldEmployeesTable.deletedBy,
    suspendedAt: usersTable.suspendedAt,
    mustChangePasswordRaw: usersTable.mustChangePassword,
  };
  // Shape the joined row into the wire shape used by the office Edit
  // modal: surface the suspended_at timestamp, derive a plain hasLogin
  // boolean from the linked user link, and coalesce the nullable
  // mustChangePassword flag.
  const shape = <
    R extends {
      userId: number | null;
      suspendedAt: Date | string | null;
      mustChangePasswordRaw: boolean | null;
      profilePendingReviewAt?: Date | string | null;
    },
  >(
    row: R,
  ) => {
    const { mustChangePasswordRaw, suspendedAt, profilePendingReviewAt, ...rest } = row;
    return {
      ...rest,
      suspendedAt:
        suspendedAt instanceof Date
          ? suspendedAt.toISOString()
          : (suspendedAt ?? null),
      profilePendingReviewAt:
        profilePendingReviewAt instanceof Date
          ? profilePendingReviewAt.toISOString()
          : (profilePendingReviewAt ?? null),
      hasLogin: row.userId !== null && row.userId !== undefined,
      mustChangePassword: !!mustChangePasswordRaw,
    };
  };
  const conds = [notInArray(fieldEmployeesTable.vendorRole, ["field", "foreman"])];
  if (vendorId) conds.push(eq(fieldEmployeesTable.vendorId, vendorId));
  if (!includeDeleted) conds.push(isNull(fieldEmployeesTable.deletedAt));
  if (session.role === "partner" && !vendorId) {
    const partnerId = session.partnerId!;
    const rows = await db
      .select(baseSelect)
      .from(fieldEmployeesTable)
      .leftJoin(vendorsTable, eq(fieldEmployeesTable.vendorId, vendorsTable.id))
      .leftJoin(usersTable, eq(fieldEmployeesTable.userId, usersTable.id))
      .innerJoin(
        partnerVendorRelationshipsTable,
        and(
          eq(partnerVendorRelationshipsTable.vendorId, fieldEmployeesTable.vendorId),
          eq(partnerVendorRelationshipsTable.partnerId, partnerId),
        ),
      )
      .where(and(...conds))
      .orderBy(fieldEmployeesTable.createdAt);
    res.json(rows.map(shape));
    return;
  }
  const rows = await db
    .select(baseSelect)
    .from(fieldEmployeesTable)
    .leftJoin(vendorsTable, eq(fieldEmployeesTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(fieldEmployeesTable.userId, usersTable.id))
    .where(and(...conds))
    .orderBy(fieldEmployeesTable.createdAt);
  res.json(rows.map(shape));
});

router.get("/vendors/:vendorId/contacts", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = ListVendorContactsParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner" && session.role !== "vendor") {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== params.data.vendorId) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role === "partner") {
    if (!session.partnerId || !(await partnerHasVendorRelationship(session.partnerId, params.data.vendorId))) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
  }
  const includeDeleted = session.role === "admin" && (req.query.includeDeleted === "true" || req.query.includeDeleted === "1");
  const conds = [
    eq(vendorContactsTable.vendorId, params.data.vendorId),
    notInArray(vendorContactsTable.vendorRole, ["field", "foreman"]),
  ];
  if (!includeDeleted) conds.push(isNull(vendorContactsTable.deletedAt));
  const contacts = await db
    .select()
    .from(vendorContactsTable)
    .where(and(...conds))
    .orderBy(vendorContactsTable.createdAt);
  sendResponse(res, ListVendorContactsResponse, contacts);
});

router.post("/vendors/:vendorId/contacts", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = CreateVendorContactParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== params.data.vendorId) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (session.role !== "admin" && session.role !== "vendor") {
    res.status(403).json({ error: "Admin or vendor access required", code: "auth.admin_or_vendor_required" });
    return;
  }
  const parsed = CreateVendorContactBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const [contact] = await db
    .insert(vendorContactsTable)
    .values({ ...parsed.data, vendorRole: parsed.data.vendorRole ?? "office", vendorId: params.data.vendorId })
    .returning();
  res.status(201).json(contact);
});

router.patch("/vendors/:vendorId/contacts/:contactId", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = UpdateVendorContactParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const auth = await assertCanManageVendorPeople(session, params.data.vendorId);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message, code: "auth.forbidden" });
    return;
  }
  const parsed = UpdateVendorContactBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const [target] = await db
    .select({
      id: vendorContactsTable.id,
      vendorId: vendorContactsTable.vendorId,
      vendorRole: vendorContactsTable.vendorRole,
      pecCertification: vendorContactsTable.pecCertification,
      pecExpirationDate: vendorContactsTable.pecExpirationDate,
    })
    .from(vendorContactsTable)
    .where(and(
      eq(vendorContactsTable.id, params.data.contactId),
      eq(vendorContactsTable.vendorId, params.data.vendorId),
      isNull(vendorContactsTable.deletedAt),
    ));
  if (!target) {
    res.status(404).json({ error: "Contact not found", code: "contact.not_found" });
    return;
  }
  const roleCheck = await validateVendorRoleAssignment(session, target, parsed.data.vendorRole);
  if (!roleCheck.ok) {
    res.status(roleCheck.status).json({ error: roleCheck.message, code: "auth.forbidden" });
    return;
  }
  const [contact] = await db
    .update(vendorContactsTable)
    .set({
      ...parsed.data,
      ...(session.role === "vendor" || session.role === "admin"
        ? { profilePendingReviewAt: null }
        : {}),
    })
    .where(and(
      eq(vendorContactsTable.id, params.data.contactId),
      eq(vendorContactsTable.vendorId, params.data.vendorId),
      isNull(vendorContactsTable.deletedAt),
    ))
    .returning();
  if (!contact) {
    res.status(404).json({ error: "Contact not found", code: "contact.not_found" });
    return;
  }
  res.json(contact);
});

router.delete("/vendors/:vendorId/contacts/:contactId", async (req, res): Promise<void> => {
  const params = DeleteVendorContactParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const session = getSession(req);
  if (!session || !["admin", "vendor"].includes(session.role)) {
    res.status(401).json({ error: "Admin or vendor login required", code: "auth.admin_or_vendor_login_required" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== params.data.vendorId) {
    res.status(403).json({ error: "Not allowed", code: "auth.not_allowed" });
    return;
  }
  const [deleted] = await db
    .update(vendorContactsTable)
    .set({ deletedAt: sql`now()`, deletedBy: `${session.role}:${session.userId}`, isActive: false })
    .where(and(
      eq(vendorContactsTable.id, params.data.contactId),
      eq(vendorContactsTable.vendorId, params.data.vendorId),
      notInArray(vendorContactsTable.vendorRole, ["field", "foreman"]),
      isNull(vendorContactsTable.deletedAt),
    ))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Contact not found", code: "contact.not_found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/vendors/:vendorId/contacts/:contactId/restore", async (req, res): Promise<void> => {
  const params = DeleteVendorContactParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    res.status(401).json({ error: "Admin login required", code: "auth.admin_login_required" });
    return;
  }
  const [restored] = await db
    .update(vendorContactsTable)
    .set({ deletedAt: null, deletedBy: null, isActive: true })
    .where(and(
      eq(vendorContactsTable.id, params.data.contactId),
      eq(vendorContactsTable.vendorId, params.data.vendorId),
      notInArray(vendorContactsTable.vendorRole, ["field", "foreman"]),
    ))
    .returning();
  if (!restored) {
    res.status(404).json({ error: "Contact not found", code: "contact.not_found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/vendors/:vendorId/notes", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = ListVendorNotesParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Admin or partner access required", code: "auth.admin_or_partner_required" });
    return;
  }
  if (session.role === "partner") {
    if (!session.partnerId || !(await partnerHasVendorRelationship(session.partnerId, params.data.vendorId))) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
  }
  const notes = await db
    .select()
    .from(vendorNotesTable)
    .where(eq(vendorNotesTable.vendorId, params.data.vendorId))
    .orderBy(vendorNotesTable.createdAt);
  sendResponse(res, ListVendorNotesResponse, notes);
});

router.post("/vendors/:vendorId/notes", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = CreateVendorNoteParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Admin or partner access required", code: "auth.admin_or_partner_required" });
    return;
  }
  if (session.role === "partner") {
    if (!session.partnerId || !(await partnerHasVendorRelationship(session.partnerId, params.data.vendorId))) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
  }
  const parsed = CreateVendorNoteBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const [note] = await db
    .insert(vendorNotesTable)
    .values({ ...parsed.data, vendorId: params.data.vendorId })
    .returning();
  res.status(201).json(note);
});

router.delete("/vendors/:vendorId/notes/:noteId", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = DeleteVendorNoteParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  if (session.role !== "admin" && session.role !== "partner") {
    res.status(403).json({ error: "Admin or partner access required", code: "auth.admin_or_partner_required" });
    return;
  }
  if (session.role === "partner") {
    if (!session.partnerId || !(await partnerHasVendorRelationship(session.partnerId, params.data.vendorId))) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
  }
  const [deleted] = await db
    .delete(vendorNotesTable)
    .where(and(
      eq(vendorNotesTable.id, params.data.noteId),
      eq(vendorNotesTable.vendorId, params.data.vendorId),
    ))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Note not found", code: "note.not_found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
