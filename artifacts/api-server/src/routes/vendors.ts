import { Router, type IRouter } from "express";
import { eq, and, notInArray, isNull, sql, desc, ilike, or, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import crypto from "crypto";
import { z } from "zod/v4";
import { db, pool, vendorsTable, vendorContactsTable, vendorNotesTable, fieldEmployeesTable, partnerVendorRelationshipsTable, usersTable, vendorMergeAuditLogTable } from "@workspace/db";
import { SESSION_SECRET } from "../lib/session";
import {
  planMerge,
  applyMerge,
  repointMerge,
  totalMoved,
  totalConflictDeleted,
  PartialConflictError,
  type MergedRowIds,
} from "../lib/vendor-merge";
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

// ──────────────────────────────────────────────────────────────────
// Vendor merge (admin only)
// ──────────────────────────────────────────────────────────────────
//
// `POST /vendors/:id/merge-preview` and `POST /vendors/:id/merge-into`
// share the same body shape and validation: `:id` is the *loser* vendor
// (the row that disappears) and `survivorVendorId` in the body is the
// vendor that absorbs every FK row. The preview runs the same FK
// scanning logic as the apply path inside a BEGIN/ROLLBACK so the admin
// sees the exact per-table counts that the merge would produce, without
// touching data. The apply path wraps the rewrite + audit-log insert in
// a single BEGIN/COMMIT so a failure in either rolls everything back.
//
// Both endpoints translate `PartialConflictError` (raised by the shared
// lib when a partial-index collision would block the merge) into a 409
// with the colliding rows so the admin can resolve them by hand before
// retrying.
async function loadMergePair(
  res: any,
  loserId: number,
  survivorId: number,
): Promise<
  | { ok: true; loser: { id: number; name: string }; survivor: { id: number; name: string } }
  | { ok: false }
> {
  if (loserId === survivorId) {
    res.status(400).json({ error: "Cannot merge a vendor into itself", code: "vendor.cannot_merge_self" });
    return { ok: false };
  }
  const rows = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(sql`${vendorsTable.id} IN (${loserId}, ${survivorId})`);
  const loser = rows.find((r) => r.id === loserId);
  const survivor = rows.find((r) => r.id === survivorId);
  if (!loser) {
    res.status(404).json({ error: "Loser vendor not found", code: "vendor.loser_not_found" });
    return { ok: false };
  }
  if (!survivor) {
    res.status(404).json({ error: "Survivor vendor not found", code: "vendor.survivor_not_found" });
    return { ok: false };
  }
  return { ok: true, loser, survivor };
}

router.post("/vendors/:id/merge-preview", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  const loserId = Number(req.params.id);
  if (!Number.isInteger(loserId)) {
    res.status(400).json({ error: "Bad vendor id", code: "vendor.invalid_id" });
    return;
  }
  const survivorId = Number(req.body?.survivorVendorId);
  if (!Number.isInteger(survivorId)) {
    res.status(400).json({ error: "survivorVendorId must be an integer", code: "vendor.invalid_survivor_id" });
    return;
  }
  const pair = await loadMergePair(res, loserId, survivorId);
  if (!pair.ok) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const counts = await planMerge(client, survivorId, loserId);
      await client.query("ROLLBACK");
      res.json({
        survivorVendorId: survivorId,
        survivorVendorName: pair.survivor.name,
        loserVendorId: loserId,
        loserVendorName: pair.loser.name,
        counts,
        totalMoved: totalMoved(counts),
        totalConflictDeleted: totalConflictDeleted(counts),
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (err instanceof PartialConflictError) {
        // @allow-english-only-error — legacy `PARTIAL_CONFLICT` code from
        // PartialConflictError, tracked in migration backlog (Task #596).
        res.status(409).json({
          error: err.message,
          code: err.code,
          table: err.table,
          description: err.description,
          rows: err.rows,
        });
        return;
      }
      throw err;
    }
  } finally {
    client.release();
  }
});

router.post("/vendors/:id/merge-into", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  const loserId = Number(req.params.id);
  if (!Number.isInteger(loserId)) {
    res.status(400).json({ error: "Bad vendor id", code: "vendor.invalid_id" });
    return;
  }
  const survivorId = Number(req.body?.survivorVendorId);
  if (!Number.isInteger(survivorId)) {
    res.status(400).json({ error: "survivorVendorId must be an integer", code: "vendor.invalid_survivor_id" });
    return;
  }
  const pair = await loadMergePair(res, loserId, survivorId);
  if (!pair.ok) return;

  // Snapshot the loser row BEFORE the transaction deletes it. The audit
  // log keeps this verbatim so a support engineer can answer "what was
  // vendor #1234 again?" months after the merge has erased the row.
  const [loserSnapshot] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, loserId));
  if (!loserSnapshot) {
    res.status(404).json({ error: "Loser vendor not found", code: "vendor.loser_not_found" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let counts;
    let rowIds;
    try {
      ({ counts, rowIds } = await applyMerge(client, survivorId, loserId));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (err instanceof PartialConflictError) {
        // @allow-english-only-error — legacy `PARTIAL_CONFLICT` code from
        // PartialConflictError, tracked in migration backlog (Task #596).
        res.status(409).json({
          error: err.message,
          code: err.code,
          table: err.table,
          description: err.description,
          rows: err.rows,
        });
        return;
      }
      throw err;
    }
    const moved = totalMoved(counts);
    const dropped = totalConflictDeleted(counts);
    // Forwarded-for first hop is the original client when behind a reverse
    // proxy; fall back to the socket address otherwise.
    const fwd = req.headers["x-forwarded-for"];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0]?.trim()) ||
      req.socket?.remoteAddress ||
      null;
    const ua = (req.headers["user-agent"] as string | undefined) ?? null;
    const auditInsert = await client.query(
      `INSERT INTO vendor_merge_audit_log
         (survivor_vendor_id, survivor_vendor_name,
          loser_vendor_id, loser_vendor_name, loser_snapshot,
          counts, moved_row_ids, total_moved, total_conflict_deleted,
          actor_user_id, actor_role, actor_ip, actor_user_agent)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        survivorId,
        pair.survivor.name,
        loserId,
        pair.loser.name,
        JSON.stringify(loserSnapshot),
        JSON.stringify(counts),
        JSON.stringify(rowIds),
        moved,
        dropped,
        session.userId,
        session.role,
        ip,
        ua,
      ],
    );
    await client.query("COMMIT");
    res.json({
      survivorVendorId: survivorId,
      survivorVendorName: pair.survivor.name,
      loserVendorId: loserId,
      loserVendorName: pair.loser.name,
      counts,
      rowIds,
      totalMoved: moved,
      totalConflictDeleted: dropped,
      auditLogId: auditInsert.rows[0].id as number,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// ──────────────────────────────────────────────────────────────────
// Vendor merge audit log + revert (admin only)
// ──────────────────────────────────────────────────────────────────
//
// Read-only views over `vendor_merge_audit_log`. Every successful
// `POST /vendors/:id/merge-into` writes one row; these endpoints
// expose that history to the admin "Vendor merge history" page so
// support can investigate "what happened to vendor #X two months
// ago?" without dropping into psql.
//
// `GET /admin/vendor-merges` returns a paged summary list (newest
// first). The `counts` map and `loserSnapshot` jsonb are
// intentionally NOT included on the list — both can grow large
// (one entry per FK table touched, plus an arbitrary-shape vendor
// row) and a list of 50 rows shouldn't drag in 50 fat blobs the UI
// only renders when the operator clicks through.
//
// `GET /admin/vendor-merges/:id` returns the full row, joined to
// `users.display_name` so the actor is rendered with a human name
// rather than a bare numeric id (the FK is `ON DELETE SET NULL`,
// so `actorDisplayName` may be null for very old rows where the
// admin user has since been deleted).
//
// `POST /admin/vendor-merges/:id/revert` is a first-cut undo for the
// case "we picked the wrong survivor — please recreate the loser
// vendor so we can re-attach things by hand". The FK rows that moved
// during the merge are NOT reverted here — they stay on the survivor
// — because the audit log doesn't track which rows were rewritten.
// What we *do* know is the loser vendor's row itself, which the merge
// endpoint snapshotted into `vendor_merge_audit_log.loser_snapshot`
// before deleting it. Restoring just that row gives the support
// engineer something to re-attach contacts/relationships to, and
// unblocks the common "recreate then manually fix up" workflow
// without resorting to raw SQL. We reuse the original numeric id (the
// snapshot's `id`) so any external references that still mention it
// line up; the endpoint refuses to run if a vendor with that id
// already exists.
const VENDOR_MERGE_LIST_DEFAULT_LIMIT = 50;
const VENDOR_MERGE_LIST_MAX_LIMIT = 200;

// Snapshot rows go back to ~September 2024 when the merge audit log
// was added, so `createdAt` is always present. Older nullable columns
// may still be missing on very old rows — anything not in the snapshot
// falls through to the column default.
const VendorRestoreSnapshotSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    name: z.string().min(1),
    contactName: z.string(),
    contactEmail: z.string(),
    contactPhone: z.string().nullable().optional(),
    physicalAddress: z.string().nullable().optional(),
    billingAddress: z.string().nullable().optional(),
    operatingRadiusMiles: z.coerce.number().int().nullable().optional(),
    latitude: z.coerce.number().nullable().optional(),
    longitude: z.coerce.number().nullable().optional(),
    geocodedAt: z.coerce.date().nullable().optional(),
    stateTaxId: z.string().nullable().optional(),
    federalTaxId: z.string().nullable().optional(),
    businessPhone: z.string().nullable().optional(),
    hoursOfOperation: z.string().nullable().optional(),
    blurb: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),
    logoSquareUrl: z.string().nullable().optional(),
    brandPrimaryColor: z.string().nullable().optional(),
    brandAccentColor: z.string().nullable().optional(),
    // Numeric (precision/scale) columns come back from the DB as strings,
    // so we accept either shape and pass through whatever's there.
    dailyOtHours: z.union([z.string(), z.number()]).nullable().optional(),
    weeklyOtHours: z.union([z.string(), z.number()]).nullable().optional(),
    overtimeMultiplier: z.union([z.string(), z.number()]).nullable().optional(),
    insuranceCarrier: z.string().nullable().optional(),
    insurancePolicyNumber: z.string().nullable().optional(),
    insuranceExpirationDate: z.string().nullable().optional(),
    coiDocumentUrl: z.string().nullable().optional(),
    agingThresholdDays: z.array(z.number()).optional(),
    eDeliveryConsent: z.boolean().optional(),
    eDeliveryConsentAt: z.coerce.date().nullable().optional(),
    eDeliveryEmail: z.string().nullable().optional(),
    accountingFailureNotificationsEnabled: z.boolean().optional(),
    accountingReconciliationNotificationsEnabled: z.boolean().optional(),
    accountingReconciliationDigestCadence: z
      .enum(["per_push", "weekly_recap"])
      .optional(),
    createdAt: z.coerce.date(),
  })
  .passthrough();

router.get("/admin/vendor-merges", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }

  // Clamp limit / offset to sane ranges so a typo in the query
  // string can't ask for a million rows or a negative offset.
  let limit = Number(req.query.limit ?? VENDOR_MERGE_LIST_DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit < 1) limit = VENDOR_MERGE_LIST_DEFAULT_LIMIT;
  if (limit > VENDOR_MERGE_LIST_MAX_LIMIT) limit = VENDOR_MERGE_LIST_MAX_LIMIT;
  limit = Math.floor(limit);

  let offset = Number(req.query.offset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);

  // Optional filters (Task #829). All filters AND together; an
  // empty / unparseable filter is treated as "no filter" rather
  // than 400'd so the UI can wire up partially-completed forms
  // without losing the rest of the result set.
  const filters: ReturnType<typeof and>[] = [];

  const rawQ = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (rawQ) {
    // Match against either vendor name. `%` and `_` in user input
    // are escaped so a query like "10%_bonus" doesn't act as a
    // wildcard. Also escape `\` itself since Postgres ILIKE uses
    // backslash as the default ESCAPE character.
    const escaped = rawQ.replace(/[\\%_]/g, (c) => `\\${c}`);
    const needle = `%${escaped}%`;
    const orClause = or(
      ilike(vendorMergeAuditLogTable.survivorVendorName, needle),
      ilike(vendorMergeAuditLogTable.loserVendorName, needle),
    );
    if (orClause) filters.push(orClause);
  }

  const rawActor = req.query.actorUserId;
  if (rawActor !== undefined && rawActor !== "") {
    const actorId = Number(rawActor);
    if (Number.isInteger(actorId) && actorId > 0) {
      filters.push(eq(vendorMergeAuditLogTable.actorUserId, actorId));
    }
  }

  const rawFrom = typeof req.query.createdFrom === "string" ? req.query.createdFrom : "";
  if (rawFrom) {
    const d = new Date(rawFrom);
    if (!Number.isNaN(d.getTime())) {
      filters.push(gte(vendorMergeAuditLogTable.createdAt, d));
    }
  }

  const rawTo = typeof req.query.createdTo === "string" ? req.query.createdTo : "";
  if (rawTo) {
    const d = new Date(rawTo);
    if (!Number.isNaN(d.getTime())) {
      filters.push(lte(vendorMergeAuditLogTable.createdAt, d));
    }
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  // Self-join `users` twice — once for the merge actor (actor_user_id),
  // once for whoever clicked Undo (reverted_by_user_id) — so the list
  // can render both names without a per-row N+1 lookup.
  const reverterUsers = alias(usersTable, "reverter_users");
  const rows = await db
    .select({
      id: vendorMergeAuditLogTable.id,
      survivorVendorId: vendorMergeAuditLogTable.survivorVendorId,
      survivorVendorName: vendorMergeAuditLogTable.survivorVendorName,
      loserVendorId: vendorMergeAuditLogTable.loserVendorId,
      loserVendorName: vendorMergeAuditLogTable.loserVendorName,
      totalMoved: vendorMergeAuditLogTable.totalMoved,
      totalConflictDeleted: vendorMergeAuditLogTable.totalConflictDeleted,
      actorUserId: vendorMergeAuditLogTable.actorUserId,
      actorDisplayName: usersTable.displayName,
      actorRole: vendorMergeAuditLogTable.actorRole,
      createdAt: vendorMergeAuditLogTable.createdAt,
      revertedAt: vendorMergeAuditLogTable.revertedAt,
      revertedByDisplayName: reverterUsers.displayName,
    })
    .from(vendorMergeAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, vendorMergeAuditLogTable.actorUserId))
    .leftJoin(
      reverterUsers,
      eq(reverterUsers.id, vendorMergeAuditLogTable.revertedByUserId),
    )
    .where(where)
    .orderBy(desc(vendorMergeAuditLogTable.createdAt), desc(vendorMergeAuditLogTable.id))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`cast(count(*) as integer)` })
    .from(vendorMergeAuditLogTable)
    .where(where);

  res.json({
    items: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    })),
    total,
    limit,
    offset,
  });
});

router.get("/admin/vendor-merges/:id", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Bad audit log id", code: "vendor_merge_audit.invalid_id" });
    return;
  }

  const reverterUsers = alias(usersTable, "reverter_users");
  const [row] = await db
    .select({
      id: vendorMergeAuditLogTable.id,
      survivorVendorId: vendorMergeAuditLogTable.survivorVendorId,
      survivorVendorName: vendorMergeAuditLogTable.survivorVendorName,
      loserVendorId: vendorMergeAuditLogTable.loserVendorId,
      loserVendorName: vendorMergeAuditLogTable.loserVendorName,
      loserSnapshot: vendorMergeAuditLogTable.loserSnapshot,
      counts: vendorMergeAuditLogTable.counts,
      totalMoved: vendorMergeAuditLogTable.totalMoved,
      totalConflictDeleted: vendorMergeAuditLogTable.totalConflictDeleted,
      actorUserId: vendorMergeAuditLogTable.actorUserId,
      actorDisplayName: usersTable.displayName,
      actorRole: vendorMergeAuditLogTable.actorRole,
      actorIp: vendorMergeAuditLogTable.actorIp,
      actorUserAgent: vendorMergeAuditLogTable.actorUserAgent,
      createdAt: vendorMergeAuditLogTable.createdAt,
      revertedAt: vendorMergeAuditLogTable.revertedAt,
      revertedByUserId: vendorMergeAuditLogTable.revertedByUserId,
      revertedByDisplayName: reverterUsers.displayName,
    })
    .from(vendorMergeAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, vendorMergeAuditLogTable.actorUserId))
    .leftJoin(
      reverterUsers,
      eq(reverterUsers.id, vendorMergeAuditLogTable.revertedByUserId),
    )
    .where(eq(vendorMergeAuditLogTable.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Audit log row not found", code: "vendor_merge_audit.not_found" });
    return;
  }

  // Pre-flight the same loser-id collision check the revert endpoint
  // runs, so the admin UI can hide / disable the "Revert this merge"
  // button instead of letting the admin click into a 409. Returning
  // the conflicting vendor (id + name) lets the UI explain *which*
  // vendor is squatting on the id.
  const [conflict] = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, row.loserVendorId));

  res.json({
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    loserIdAvailable: !conflict,
    conflictingVendor: conflict
      ? { id: conflict.id, name: conflict.name }
      : null,
    revertedAt:
      row.revertedAt instanceof Date
        ? row.revertedAt.toISOString()
        : (row.revertedAt ?? null),
  });
});

router.post("/admin/vendor-merges/:id/revert", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin access required", code: "auth.admin_required" });
    return;
  }
  const auditLogId = Number(req.params.id);
  if (!Number.isInteger(auditLogId) || auditLogId <= 0) {
    res.status(400).json({ error: "Bad audit log id", code: "vendor_merge.invalid_id" });
    return;
  }

  const [audit] = await db
    .select()
    .from(vendorMergeAuditLogTable)
    .where(eq(vendorMergeAuditLogTable.id, auditLogId));
  if (!audit) {
    res.status(404).json({ error: "Vendor merge audit log not found", code: "vendor_merge.not_found" });
    return;
  }

  // Idempotency gate (Task #830). Once an admin has clicked Undo on
  // this audit row we persist `reverted_at` / `reverted_by_user_id`
  // and refuse a second Undo on the same row. Without this gate the
  // second click would still 409 (the loser id check below catches
  // it), but the error would lie about the reason — the row is
  // already "back", we just don't want to pretend a re-restore did
  // anything new. Surface the original reverter so the admin can
  // chase up "who undid this and when?" without opening psql.
  if (audit.revertedAt) {
    const [reverter] = audit.revertedByUserId
      ? await db
          .select({ displayName: usersTable.displayName })
          .from(usersTable)
          .where(eq(usersTable.id, audit.revertedByUserId))
      : [];
    res.status(409).json({
      error: "This vendor merge has already been reverted.",
      code: "vendor_merge.already_reverted",
      revertedAt:
        audit.revertedAt instanceof Date
          ? audit.revertedAt.toISOString()
          : audit.revertedAt,
      revertedByDisplayName: reverter?.displayName ?? null,
    });
    return;
  }

  // Refuse if the loser id is currently held by another vendor — the
  // restore preserves the original numeric id so any lingering external
  // references (printed reports, email screenshots, support tickets)
  // still resolve. Re-using a recycled id would silently re-attach the
  // wrong vendor to those references.
  const [collision] = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, audit.loserVendorId));
  if (collision) {
    res.status(409).json({
      error: `Cannot restore: vendor id ${audit.loserVendorId} is already in use by "${collision.name}".`,
      code: "vendor_merge.loser_id_in_use",
      conflictingVendor: { id: collision.id, name: collision.name },
    });
    return;
  }

  const parsedSnapshot = VendorRestoreSnapshotSchema.safeParse(audit.loserSnapshot);
  if (!parsedSnapshot.success) {
    res.status(422).json({
      error: "Loser snapshot is missing required fields and cannot be restored automatically.",
      code: "vendor_merge.snapshot_unrecoverable",
      issues: parsedSnapshot.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    });
    return;
  }
  const snap = parsedSnapshot.data;

  // Sanity check: the snapshot's `id` should match the audit log's
  // `loser_vendor_id`. They're written together in the same transaction,
  // but a hand-edited snapshot could drift — bail out rather than
  // restoring under a different id than the one the admin clicked.
  if (snap.id !== audit.loserVendorId) {
    res.status(422).json({
      error: "Snapshot id does not match audit log loser id; cannot restore safely.",
      code: "vendor_merge.snapshot_id_mismatch",
    });
    return;
  }

  // Catch the canonical-name unique-index race upfront so the admin
  // gets a friendly 409 instead of a generic 500. The post-insert
  // catch below still handles the genuine race window.
  const [nameConflict] = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(sql`lower(btrim(${vendorsTable.name})) = lower(btrim(${snap.name}))`)
    .limit(1);
  if (nameConflict) {
    res.status(409).json({
      error: `Cannot restore: another vendor is already using the name "${nameConflict.name}".`,
      code: "vendor_merge.name_in_use",
      conflictingVendor: { id: nameConflict.id, name: nameConflict.name },
    });
    return;
  }

  const client = await pool.connect();
  let revertedAt: Date | null = null;
  try {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO vendors (
           id, name, contact_name, contact_email, contact_phone,
           physical_address, billing_address,
           operating_radius_miles, latitude, longitude, geocoded_at,
           state_tax_id, federal_tax_id, business_phone, hours_of_operation,
           blurb, logo_url, logo_square_url,
           brand_primary_color, brand_accent_color,
           daily_ot_hours, weekly_ot_hours, overtime_multiplier,
           insurance_carrier, insurance_policy_number,
           insurance_expiration_date, coi_document_url,
           aging_threshold_days,
           e_delivery_consent, e_delivery_consent_at, e_delivery_email,
           accounting_failure_notifications_enabled,
           accounting_reconciliation_notifications_enabled,
           accounting_reconciliation_digest_cadence,
           created_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7,
           $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18,
           $19, $20,
           $21, $22, $23,
           $24, $25,
           $26, $27,
           COALESCE($28::jsonb, '[1,15,30]'::jsonb),
           COALESCE($29, false), $30, $31,
           COALESCE($32, true),
           COALESCE($33, false),
           COALESCE($34, 'per_push'),
           COALESCE($35, NOW())
         )`,
        [
          snap.id,
          snap.name,
          snap.contactName,
          snap.contactEmail,
          snap.contactPhone ?? null,
          snap.physicalAddress ?? null,
          snap.billingAddress ?? null,
          snap.operatingRadiusMiles ?? null,
          snap.latitude ?? null,
          snap.longitude ?? null,
          snap.geocodedAt ?? null,
          snap.stateTaxId ?? null,
          snap.federalTaxId ?? null,
          snap.businessPhone ?? null,
          snap.hoursOfOperation ?? null,
          snap.blurb ?? null,
          snap.logoUrl ?? null,
          snap.logoSquareUrl ?? null,
          snap.brandPrimaryColor ?? null,
          snap.brandAccentColor ?? null,
          snap.dailyOtHours ?? null,
          snap.weeklyOtHours ?? null,
          snap.overtimeMultiplier ?? null,
          snap.insuranceCarrier ?? null,
          snap.insurancePolicyNumber ?? null,
          snap.insuranceExpirationDate ?? null,
          snap.coiDocumentUrl ?? null,
          snap.agingThresholdDays ? JSON.stringify(snap.agingThresholdDays) : null,
          snap.eDeliveryConsent ?? null,
          snap.eDeliveryConsentAt ?? null,
          snap.eDeliveryEmail ?? null,
          snap.accountingFailureNotificationsEnabled ?? null,
          snap.accountingReconciliationNotificationsEnabled ?? null,
          snap.accountingReconciliationDigestCadence ?? null,
          snap.createdAt,
        ],
      );

      // Bump the serial sequence past the restored id so the next
      // auto-allocated id doesn't collide. In practice the sequence is
      // already past the original id (the loser was created before it
      // was deleted), but it costs nothing to be defensive against a
      // restore done after a TRUNCATE+reset.
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence('vendors', 'id'),
           GREATEST((SELECT COALESCE(MAX(id), 1) FROM vendors), 1)
         )`,
      );

      // Re-point the FK rows the original merge moved off the loser
      // back onto the restored loser, inside the same transaction so
      // a unique-violation halfway through aborts the whole revert
      // and the loser stays "all or nothing". `moved_row_ids` is the
      // jsonb column written by the merge endpoint; it's null for
      // audit rows written before the column existed (in that case
      // we silently skip the repoint and the response surfaces a
      // `repointed: null` so the admin knows row-id tracking wasn't
      // available — they still get the loser back, just have to
      // re-attach things by hand the old way).
      const tracked = audit.movedRowIds as MergedRowIds | null;
      let repointResult: Awaited<ReturnType<typeof repointMerge>> | null = null;
      if (tracked && audit.survivorVendorId != null) {
        try {
          repointResult = await repointMerge(
            client,
            audit.survivorVendorId,
            snap.id,
            tracked,
          );
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          const cause = (err as { code?: string; constraint?: string }) ?? {};
          if (cause.code === "23505") {
            res.status(409).json({
              error:
                "Cannot re-point merged rows back to the restored vendor: " +
                "a unique-index conflict was raised. The survivor likely " +
                "accumulated a colliding row after the merge. Resolve the " +
                "conflict on the survivor first, then retry the revert.",
              code: "vendor_merge.repoint_conflict",
              constraint: cause.constraint ?? null,
            });
            return;
          }
          throw err;
        }
      }

      // Mark the audit row reverted in the same transaction so the
      // restore + repoint + idempotency receipt commit atomically.
      // Guard on `reverted_at IS NULL` so a concurrent Undo from
      // another admin (already past the pre-check above) loses the
      // race here and gets a `vendor_merge.already_reverted` 409 on
      // its next attempt rather than silently double-restoring.
      const markRes = await client.query(
        `UPDATE vendor_merge_audit_log
            SET reverted_at = NOW(), reverted_by_user_id = $1
          WHERE id = $2 AND reverted_at IS NULL
        RETURNING reverted_at`,
        [session.userId ?? null, auditLogId],
      );
      if (markRes.rowCount === 0) {
        // Lost the race — another admin reverted between our pre-check
        // and the UPDATE. Bail out so we don't ship a misleading 200.
        throw Object.assign(new Error("already_reverted_race"), {
          __alreadyReverted: true,
        });
      }
      revertedAt = markRes.rows[0].reverted_at as Date;

      await client.query("COMMIT");

      // Build the response payload after COMMIT so the admin sees
      // exactly what we committed (and so any post-COMMIT failure
      // wouldn't leave the response and the DB out of sync).
      const responsePayload: Record<string, unknown> = {
        restoredVendorId: snap.id,
        restoredVendorName: snap.name,
        auditLogId: audit.id,
        revertedAt: revertedAt
          ? revertedAt instanceof Date
            ? revertedAt.toISOString()
            : revertedAt
          : new Date().toISOString(),
      };
      if (tracked == null) {
        // Audit row predates row-id tracking — surface a friendly
        // null so the UI can render "merged rows must be re-attached
        // by hand" instead of pretending the repoint succeeded.
        responsePayload.repointed = null;
        responsePayload.repointTracked = false;
      } else if (audit.survivorVendorId == null) {
        // Survivor vendor was deleted between merge and revert
        // (the FK is `ON DELETE SET NULL`). We can't re-point because
        // we don't know which vendor currently owns the rows.
        responsePayload.repointed = null;
        responsePayload.repointTracked = true;
        responsePayload.repointSkippedReason = "survivor_vendor_deleted";
      } else if (repointResult) {
        responsePayload.repointed = repointResult.repointed;
        responsePayload.repointedRowIds = repointResult.repointedRowIds;
        responsePayload.missingRowIds = repointResult.missing;
        responsePayload.unrecoverableRowIds = repointResult.unrecoverable;
        responsePayload.repointTracked = true;
        let totalRepointed = 0;
        let totalMissing = 0;
        let totalUnrecoverable = 0;
        for (const n of Object.values(repointResult.repointed)) {
          totalRepointed += n;
        }
        for (const ids of Object.values(repointResult.missing)) {
          totalMissing += ids.length;
        }
        for (const ids of Object.values(repointResult.unrecoverable)) {
          totalUnrecoverable += ids.length;
        }
        responsePayload.totalRepointed = totalRepointed;
        responsePayload.totalMissing = totalMissing;
        responsePayload.totalUnrecoverable = totalUnrecoverable;
      }

      const [restored] = await db
        .select()
        .from(vendorsTable)
        .where(eq(vendorsTable.id, snap.id));
      if (restored) responsePayload.restoredVendorName = restored.name;
      res.json(responsePayload);
      return;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const cause = (err as { code?: string; constraint?: string; __alreadyReverted?: boolean }) ?? {};
      // Concurrent Undo from another admin won the UPDATE race. Treat
      // it the same as the pre-check `vendor_merge.already_reverted`
      // branch above so the client can branch on a stable code.
      if (cause.__alreadyReverted) {
        res.status(409).json({
          error: "This vendor merge has already been reverted.",
          code: "vendor_merge.already_reverted",
        });
        return;
      }
      // Race: someone created a vendor with the same canonical name (or
      // the same id, somehow) between our pre-check and the insert.
      if (cause.code === "23505") {
        res.status(409).json({
          error: "Cannot restore: another vendor with this id or name was created concurrently.",
          code: "vendor_merge.restore_conflict",
          constraint: cause.constraint ?? null,
        });
        return;
      }
      throw err;
    }
  } finally {
    client.release();
  }
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
