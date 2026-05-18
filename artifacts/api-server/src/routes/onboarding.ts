import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  partnersTable,
  vendorsTable,
  usersTable,
  vendorPeopleTable,
  userOrgMembershipsTable,
  onboardingProgressTable,
  siteLocationsTable,
  vendorWorkTypesTable,
  partnerContactsTable,
} from "@workspace/db";
import {
  CreatePartnerOnboardingBody,
  CreateVendorOnboardingBody,
  UpdateOnboardingProgressBody,
  CompleteFieldOnboardingBody,
} from "@workspace/api-zod";
import { SESSION_SECRET, getSessionFromRequest } from "../lib/session";
import { addMembership } from "../lib/membership-sync";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import { normalizeVendorName } from "../lib/vendor-match";

import { sendValidationFailed } from "../lib/validation-error";
const onboardingObjectStorageService = new ObjectStorageService();

const router: IRouter = Router();

const COOKIE_NAME = "vndrly_session";
const SESSION_TTL_SECS = 24 * 60 * 60;
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECS * 1000,
};

function signPayload(payload: string): string {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function buildSessionCookie(args: {
  user: typeof usersTable.$inferSelect;
  membershipId: number;
  role: "admin" | "partner" | "vendor" | "field_employee";
  membershipRole: "admin" | "member" | "field_employee";
  partnerId: number | null;
  vendorId: number | null;
  vendorPeopleId: number | null;
}): string {
  const nowSecs = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      userId: args.user.id,
      role: args.role,
      membershipRole: args.membershipRole,
      displayName: args.user.displayName,
      partnerId: args.partnerId,
      vendorId: args.vendorId,
      vendorRole: null,
      vendorPeopleId: args.vendorPeopleId,
      activeMembershipId: args.membershipId,
      iat: nowSecs,
      exp: nowSecs + SESSION_TTL_SECS,
      sv: args.user.sessionVersion ?? 1,
    }),
  ).toString("base64");
  return signPayload(payload);
}

function serializeProgress(row: typeof onboardingProgressTable.$inferSelect) {
  return {
    id: row.id,
    orgType: row.orgType,
    partnerId: row.partnerId ?? null,
    vendorId: row.vendorId ?? null,
    vendorPeopleId: row.vendorPeopleId ?? null,
    currentStep: row.currentStep,
    completedSteps: row.completedSteps,
    skippedSteps: row.skippedSteps,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ensureProgressRow(args: {
  orgType: "partner" | "vendor" | "field_employee";
  partnerId?: number | null;
  vendorId?: number | null;
  vendorPeopleId?: number | null;
  defaultStep: string;
}): Promise<typeof onboardingProgressTable.$inferSelect> {
  const where =
    args.orgType === "partner"
      ? eq(onboardingProgressTable.partnerId, args.partnerId!)
      : args.orgType === "vendor"
        ? eq(onboardingProgressTable.vendorId, args.vendorId!)
        : eq(onboardingProgressTable.vendorPeopleId, args.vendorPeopleId!);
  const [existing] = await db.select().from(onboardingProgressTable).where(where).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(onboardingProgressTable)
    .values({
      orgType: args.orgType,
      partnerId: args.partnerId ?? null,
      vendorId: args.vendorId ?? null,
      vendorPeopleId: args.vendorPeopleId ?? null,
      currentStep: args.defaultStep,
      completedSteps: [],
      skippedSteps: [],
      payload: {},
    })
    .returning();
  return created;
}

// ─────────────────────────────────────────────────────────────────
// Email-verification helper. Generates a single-use token, persists
// it on the users row, and emails the recipient a /api/onboarding
// /verify-email/:token link. Used during onboarding (account
// creation) and via the in-wizard "Resend" button. Failures are
// swallowed to logs because verification is best-effort — the user
// can still keep onboarding even if SendGrid is down.
// ─────────────────────────────────────────────────────────────────
async function issueAndEmailVerification(args: {
  userId: number;
  email: string;
  displayName: string;
}): Promise<{ tokenIssued: boolean; emailSent: boolean }> {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  try {
    await db
      .update(usersTable)
      .set({
        emailVerifyToken: token,
        emailVerifyTokenExpiresAt: expiresAt,
      })
      .where(eq(usersTable.id, args.userId));
  } catch (err) {
    logger.warn({ err, userId: args.userId }, "verify-email: token persist failed");
    return { tokenIssued: false, emailSent: false };
  }

  const baseUrl =
    process.env.APP_BASE_URL ||
    `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  const url = `${baseUrl}/api/onboarding/verify-email/${encodeURIComponent(token)}`;
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const safeName = escapeHtml(args.displayName);
  const safeUrl = escapeHtml(url);

  try {
    const { getUncachableSendGridClient } = await import("../lib/sendgrid");
    const { client, fromEmail } = await getUncachableSendGridClient();
    await client.send({
      to: args.email,
      from: fromEmail,
      subject: "Confirm your VNDRLY account",
      text: `Hi ${args.displayName},\n\nThanks for creating your VNDRLY account. Please confirm your email by visiting:\n\n${url}\n\nThis link expires in 24 hours. If you didn't sign up, you can ignore this email.`,
      html: `<p>Hi <strong>${safeName}</strong>,</p><p>Thanks for creating your VNDRLY account. Please confirm your email by clicking the button below — this helps us prove you're not a bot and lets you receive notifications.</p><p><a href="${safeUrl}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">Confirm my email</a></p><p>Or copy this link into your browser:<br/><a href="${safeUrl}">${safeUrl}</a></p><p style="color:#6b7280;font-size:12px">This link expires in 24 hours. If you didn't sign up, you can safely ignore this email.</p>`,
    });
    return { tokenIssued: true, emailSent: true };
  } catch (err) {
    logger.warn({ err, userId: args.userId }, "verify-email: email send failed");
    return { tokenIssued: true, emailSent: false };
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /onboarding/partner — public, creates org + admin user
// ─────────────────────────────────────────────────────────────────
router.post("/onboarding/partner", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreatePartnerOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const { name, contactName, contactEmail, contactPhone, password } = parsed.data;
  const cleanEmail = contactEmail.trim().toLowerCase();

  // Reject duplicate org name (case-insensitive)
  const [dup] = await db
    .select({ id: partnersTable.id, name: partnersTable.name })
    .from(partnersTable)
    .where(sql`lower(btrim(${partnersTable.name})) = lower(btrim(${name}))`)
    .limit(1);
  if (dup) {
    res.status(409).json({
      error: `A partner named "${dup.name}" already exists.`,
      code: "partner.duplicate_name",
      // Forwarded as i18next interpolation values by the web client's
      // translateApiError helper so the localized copy can render the
      // conflicting partner name.
      details: { name: dup.name },
    });
    return;
  }
  const [emailDup] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = ${cleanEmail}`)
    .limit(1);
  if (emailDup) {
    res.status(409).json({ error: "An account with that email already exists.", code: "auth.email_taken" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.transaction(async (tx) => {
      const [partner] = await tx
        .insert(partnersTable)
        .values({ name, contactName, contactEmail: cleanEmail, contactPhone: contactPhone ?? null })
        .returning();
      const [user] = await tx
        .insert(usersTable)
        .values({
          username: cleanEmail,
          email: cleanEmail,
          passwordHash,
          role: "partner",
          displayName: contactName,
        })
        .returning();
      // Insert the membership row in the same transaction so a brand-
      // new user is never visible without the matching
      // `user_org_memberships` row.
      const membershipId = await addMembership(
        {
          userId: user.id,
          orgType: "partner",
          orgId: partner.id,
          role: "admin",
        },
        tx,
      );
      return { partner, user, membershipId };
    });
    const { membershipId } = result;
    const progress = await ensureProgressRow({
      orgType: "partner",
      partnerId: result.partner.id,
      defaultStep: "company-basics",
    });

    const cookie = buildSessionCookie({
      user: result.user,
      membershipId,
      role: "partner",
      membershipRole: "admin",
      partnerId: result.partner.id,
      vendorId: null,
      vendorPeopleId: null,
    });
    res.cookie(COOKIE_NAME, cookie, COOKIE_OPTIONS);
    // Fire-and-forget bot-prevention email verification. We don't
    // await the result blocking the response — the wizard polls
    // /onboarding/me to see verification state and exposes a Resend.
    void issueAndEmailVerification({
      userId: result.user.id,
      email: cleanEmail,
      displayName: contactName,
    });
    res.status(201).json({
      orgType: "partner",
      orgId: result.partner.id,
      userId: result.user.id,
      progress: serializeProgress(progress),
    });
  } catch (err) {
    logger.error({ err }, "createPartnerOnboarding failed");
    res.status(500).json({ error: "Failed to create partner", code: "onboarding.create_partner_failed" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /onboarding/vendor — public, creates org + admin user
// ─────────────────────────────────────────────────────────────────
router.post("/onboarding/vendor", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateVendorOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const { name, contactName, contactEmail, contactPhone, password } = parsed.data;
  const cleanEmail = contactEmail.trim().toLowerCase();

  // Mobile + web public self-signup duplicate guard. We use the same
  // `normalizeVendorName` helper that the admin-side POST /vendors
  // route uses (NFKD-folded, lowercased, punctuation stripped, generic
  // corporate suffixes dropped) so "Acme Inc.", "ACME, LLC" and
  // "  acme  " all collapse to the same canonical form. The DB has a
  // separate unique index on `lower(btrim(name))` that catches plain
  // case/whitespace dupes; this canonical pre-check is intentionally
  // stricter and runs first so we can return a friendly 409 with the
  // conflicting row instead of a generic 500 from the unique-violation.
  // Task #458: applies the same guard the web admin form has so the
  // unauthenticated mobile signup flow can't sneak past it either.
  const normalizedNew = normalizeVendorName(name);
  if (normalizedNew) {
    const existing = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable);
    const dup = existing.find(
      (v) => normalizeVendorName(v.name) === normalizedNew,
    );
    if (dup) {
      res.status(409).json({
        error: `A vendor named "${dup.name}" already exists.`,
        code: "vendor.duplicate_name",
        // Forwarded as i18next interpolation values by the web/mobile
        // client's translateApiError helper so the localized copy can
        // render the conflicting vendor name.
        details: { name: dup.name },
      });
      return;
    }
  }
  const [emailDup] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = ${cleanEmail}`)
    .limit(1);
  if (emailDup) {
    res.status(409).json({ error: "An account with that email already exists.", code: "auth.email_taken" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.transaction(async (tx) => {
      const [vendor] = await tx
        .insert(vendorsTable)
        .values({ name, contactName, contactEmail: cleanEmail, contactPhone: contactPhone ?? null })
        .returning();
      const [user] = await tx
        .insert(usersTable)
        .values({
          username: cleanEmail,
          email: cleanEmail,
          passwordHash,
          role: "vendor",
          displayName: contactName,
        })
        .returning();
      // Insert the membership row in the same transaction so a brand-
      // new user is never visible without the matching
      // `user_org_memberships` row.
      const membershipId = await addMembership(
        {
          userId: user.id,
          orgType: "vendor",
          orgId: vendor.id,
          role: "admin",
        },
        tx,
      );
      return { vendor, user, membershipId };
    });
    const { membershipId } = result;
    const progress = await ensureProgressRow({
      orgType: "vendor",
      vendorId: result.vendor.id,
      defaultStep: "company-basics",
    });

    const cookie = buildSessionCookie({
      user: result.user,
      membershipId,
      role: "vendor",
      membershipRole: "admin",
      partnerId: null,
      vendorId: result.vendor.id,
      vendorPeopleId: null,
    });
    res.cookie(COOKIE_NAME, cookie, COOKIE_OPTIONS);
    void issueAndEmailVerification({
      userId: result.user.id,
      email: cleanEmail,
      displayName: contactName,
    });
    res.status(201).json({
      orgType: "vendor",
      orgId: result.vendor.id,
      userId: result.user.id,
      progress: serializeProgress(progress),
    });
  } catch (err) {
    // Race-condition fallback: a concurrent insert slipped past the
    // pre-check and the DB unique index (`vendors_canonical_name_unique`
    // on `lower(btrim(name))`) caught it. Translate the Postgres unique
    // violation into the same 409 shape the canonical-name pre-check
    // returns so the client sees a consistent error.
    const cause = (err as { cause?: { code?: string; constraint?: string } })
      .cause;
    if (
      cause?.code === "23505" &&
      cause?.constraint === "vendors_canonical_name_unique"
    ) {
      const [existing] = await db
        .select({ name: vendorsTable.name })
        .from(vendorsTable)
        .where(sql`lower(btrim(${vendorsTable.name})) = lower(btrim(${name}))`)
        .limit(1);
      const conflictName = existing?.name ?? name;
      res.status(409).json({
        error: `A vendor named "${conflictName}" already exists.`,
        code: "vendor.duplicate_name",
        details: { name: conflictName },
      });
      return;
    }
    logger.error({ err }, "createVendorOnboarding failed");
    res.status(500).json({ error: "Failed to create vendor", code: "onboarding.create_vendor_failed" });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /onboarding/me — current org's progress (or null)
// ─────────────────────────────────────────────────────────────────
router.get("/onboarding/me", async (req: Request, res: Response): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  let row: typeof onboardingProgressTable.$inferSelect | undefined;
  if (session.role === "partner" && session.partnerId) {
    [row] = await db
      .select()
      .from(onboardingProgressTable)
      .where(eq(onboardingProgressTable.partnerId, session.partnerId))
      .limit(1);
  } else if (session.role === "vendor" && session.vendorId) {
    [row] = await db
      .select()
      .from(onboardingProgressTable)
      .where(eq(onboardingProgressTable.vendorId, session.vendorId))
      .limit(1);
  }
  // Pull verification state so the wizard can render its banner
  // without a second round-trip.
  const [u] = await db
    .select({
      email: usersTable.email,
      emailVerifiedAt: usersTable.emailVerifiedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId!))
    .limit(1);
  res.json({
    progress: row ? serializeProgress(row) : null,
    user: u
      ? {
          email: u.email,
          emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
        }
      : null,
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /onboarding/verify-email/:token — public link from the
// confirmation email. Marks the user verified, then 302-redirects
// to the home page with a flag the dashboard can render a toast on.
// ─────────────────────────────────────────────────────────────────
router.get("/onboarding/verify-email/:token", async (req: Request, res: Response): Promise<void> => {
  // Express types `req.params[k]` as `string | string[]` in this version
  // even for path params; tokens are always single values, but coerce
  // defensively to satisfy the type checker.
  const rawToken = req.params.token;
  const token = (typeof rawToken === "string" ? rawToken : "").trim();
  // Normalize APP_BASE_URL: strip any trailing slash so we don't emit
  // `//?verify=...` when concatenating below. Empty/unset falls back to
  // the site root.
  const rawBase = process.env.APP_BASE_URL ?? "";
  const baseUrl = rawBase.replace(/\/+$/, "");
  const redirectTo = (kind: string) => `${baseUrl}/?verify=${kind}`;
  if (!token || token.length < 16) {
    res.redirect(redirectTo("invalid"));
    return;
  }
  const [user] = await db
    .select({
      id: usersTable.id,
      expiresAt: usersTable.emailVerifyTokenExpiresAt,
      verifiedAt: usersTable.emailVerifiedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.emailVerifyToken, token))
    .limit(1);
  if (!user) {
    res.redirect(redirectTo("invalid"));
    return;
  }
  if (user.verifiedAt) {
    // Already verified — clear the token and redirect anyway.
    await db
      .update(usersTable)
      .set({ emailVerifyToken: null, emailVerifyTokenExpiresAt: null })
      .where(eq(usersTable.id, user.id));
    res.redirect(redirectTo("already"));
    return;
  }
  if (user.expiresAt && user.expiresAt.getTime() < Date.now()) {
    res.redirect(redirectTo("expired"));
    return;
  }
  await db
    .update(usersTable)
    .set({
      emailVerifiedAt: new Date(),
      emailVerifyToken: null,
      emailVerifyTokenExpiresAt: null,
    })
    .where(eq(usersTable.id, user.id));
  res.redirect(redirectTo("ok"));
});

// ─────────────────────────────────────────────────────────────────
// POST /onboarding/resend-verification — re-issues the token and
// emails it. Auth required. Idempotent for an already-verified
// account (no-op success).
// ─────────────────────────────────────────────────────────────────
router.post("/onboarding/resend-verification", async (req: Request, res: Response): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const [u] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
      verifiedAt: usersTable.emailVerifiedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId!))
    .limit(1);
  if (!u) {
    res.status(404).json({ error: "User not found", code: "auth.not_found" });
    return;
  }
  if (u.verifiedAt) {
    res.json({ ok: true, alreadyVerified: true });
    return;
  }
  if (!u.email) {
    res
      .status(400)
      .json({ error: "No email on file", code: "verify_email.no_email_on_file" });
    return;
  }
  const result = await issueAndEmailVerification({
    userId: u.id,
    email: u.email,
    displayName: u.displayName,
  });
  if (!result.emailSent) {
    res.status(503).json({
      error: "Email service unavailable — please try again shortly.",
      code: "verify_email.send_failed",
    });
    return;
  }
  res.json({ ok: true, sentTo: u.email });
});

// ─────────────────────────────────────────────────────────────────
// Permission gate for /onboarding/:orgType/:orgId/*
// ─────────────────────────────────────────────────────────────────
function authorizeOrgAccess(req: Request, res: Response, orgType: string, orgId: number): boolean {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return false;
  }
  // Platform admins can manage any org's onboarding.
  if (session.role === "admin") return true;
  // Org members can only access their own org AND only if they hold
  // the org-admin membership role. Onboarding /complete writes
  // canonical tax/compliance/rates data, so a non-admin member must
  // not be able to mutate it.
  const isOrgAdmin = session.membershipRole === "admin";
  if (orgType === "partner" && session.role === "partner" && session.partnerId === orgId && isOrgAdmin) return true;
  if (orgType === "vendor" && session.role === "vendor" && session.vendorId === orgId && isOrgAdmin) return true;
  res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
  return false;
}

// ─────────────────────────────────────────────────────────────────
// GET /onboarding/:orgType/:orgId/progress
// ─────────────────────────────────────────────────────────────────
router.get("/onboarding/:orgType/:orgId/progress", async (req: Request, res: Response): Promise<void> => {
  const orgType = req.params.orgType;
  const orgId = Number(req.params.orgId);
  if (orgType !== "partner" && orgType !== "vendor") {
    res.status(400).json({ error: "orgType must be partner or vendor", code: "onboarding.invalid_org_type" });
    return;
  }
  if (!Number.isFinite(orgId)) {
    res.status(400).json({ error: "orgId must be an integer", code: "onboarding.invalid_org_id" });
    return;
  }
  if (!authorizeOrgAccess(req, res, orgType, orgId)) return;

  const row = await ensureProgressRow({
    orgType,
    partnerId: orgType === "partner" ? orgId : null,
    vendorId: orgType === "vendor" ? orgId : null,
    defaultStep: "company-basics",
  });
  res.json(serializeProgress(row));
});

// ─────────────────────────────────────────────────────────────────
// PUT /onboarding/:orgType/:orgId/progress
// ─────────────────────────────────────────────────────────────────
router.put("/onboarding/:orgType/:orgId/progress", async (req: Request, res: Response): Promise<void> => {
  const orgType = req.params.orgType;
  const orgId = Number(req.params.orgId);
  if (orgType !== "partner" && orgType !== "vendor") {
    res.status(400).json({ error: "orgType must be partner or vendor", code: "onboarding.invalid_org_type" });
    return;
  }
  if (!Number.isFinite(orgId)) {
    res.status(400).json({ error: "orgId must be an integer", code: "onboarding.invalid_org_id" });
    return;
  }
  if (!authorizeOrgAccess(req, res, orgType, orgId)) return;
  const parsed = UpdateOnboardingProgressBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const existing = await ensureProgressRow({
    orgType,
    partnerId: orgType === "partner" ? orgId : null,
    vendorId: orgType === "vendor" ? orgId : null,
    defaultStep: "company-basics",
  });
  const updated = await applyProgressPatch(existing, parsed.data);
  res.json(serializeProgress(updated));
});

// Shared between the org PUT and the public field-token PUT below.
async function applyProgressPatch(
  existing: typeof onboardingProgressTable.$inferSelect,
  patch: { currentStep?: string; completedSteps?: string[]; skippedSteps?: string[]; payload?: Record<string, unknown> },
) {
  const updates: Partial<typeof onboardingProgressTable.$inferInsert> = {};
  if (patch.currentStep !== undefined) updates.currentStep = patch.currentStep;
  if (patch.completedSteps !== undefined) updates.completedSteps = patch.completedSteps;
  if (patch.skippedSteps !== undefined) updates.skippedSteps = patch.skippedSteps;
  if (patch.payload !== undefined) {
    // Shallow merge so a step can patch a slice without clobbering
    // sibling-step state.
    updates.payload = {
      ...((existing.payload ?? {}) as Record<string, unknown>),
      ...(patch.payload as Record<string, unknown>),
    };
  }
  const [row] = await db
    .update(onboardingProgressTable)
    .set(updates)
    .where(eq(onboardingProgressTable.id, existing.id))
    .returning();
  return row;
}

// ─────────────────────────────────────────────────────────────────
// POST /onboarding/:orgType/:orgId/complete
//
// Validates that every required field for the persona is present in
// the saved payload, then writes that payload into canonical tables
// (partners/siteLocations for partners, vendors/vendorWorkTypes/
// vendorPeople for vendors). Only after both succeed do we mark
// completedAt — the wizard refuses to finish otherwise so that
// downstream tickets / invoicing / branding can rely on this data
// existing.
// ─────────────────────────────────────────────────────────────────
function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Mint a tokenised onboarding-invite link for a vendor employee and
// (best-effort) email it. Used by the dedicated invite endpoint and
// also fired automatically when a vendor finishes onboarding so the
// first-employee step doubles as an invite.
async function issueAndEmailFieldInvite(employeeId: number): Promise<{ token: string; url: string; emailSent: boolean }> {
  const token = crypto.randomBytes(24).toString("hex");
  await db
    .update(vendorPeopleTable)
    .set({ inviteToken: token, inviteSentAt: new Date() })
    .where(eq(vendorPeopleTable.id, employeeId));
  await ensureProgressRow({
    orgType: "field_employee",
    vendorPeopleId: employeeId,
    defaultStep: "personal-info",
  });

  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  const url = `${baseUrl}/onboarding/field/${token}`;

  const [employee] = await db
    .select({ email: vendorPeopleTable.email, firstName: vendorPeopleTable.firstName })
    .from(vendorPeopleTable)
    .where(eq(vendorPeopleTable.id, employeeId))
    .limit(1);

  let emailSent = false;
  if (employee?.email) {
    try {
      const { getUncachableSendGridClient } = await import("../lib/sendgrid");
      const { client, fromEmail } = await getUncachableSendGridClient();
      await client.send({
        to: employee.email,
        from: fromEmail,
        subject: "Finish setting up your VNDRLY account",
        text: `Hi ${employee.firstName},\n\nYour employer invited you to join VNDRLY. Tap the link below to set your password and complete a quick 3-step setup:\n\n${url}\n\nThe link expires once you've completed setup.`,
        html: `<p>Hi ${employee.firstName},</p><p>Your employer invited you to join VNDRLY. Tap the link below to set your password and complete a quick 3-step setup:</p><p><a href="${url}">${url}</a></p><p>The link expires once you've completed setup.</p>`,
      });
      emailSent = true;
    } catch (err) {
      logger.warn({ err, employeeId }, "Failed to email field onboarding invite");
    }
  }

  return { token, url, emailSent };
}

function validatePartnerPayload(p: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!trim(p.brandPrimaryColor)) missing.push("brandPrimaryColor");
  if (!trim(p.brandAccentColor)) missing.push("brandAccentColor");
  // Both logos are spec must-haves: horizontal renders in the sidebar
  // and ticket headers; square renders in 64×64 favicons and the
  // visitor portal poster.
  if (!trim(p.logoUrl)) missing.push("logoUrl");
  if (!trim(p.logoSquareUrl)) missing.push("logoSquareUrl");
  const site = (p.firstSite ?? {}) as Record<string, unknown>;
  if (!trim(site.name)) missing.push("firstSite.name");
  if (!trim(site.address)) missing.push("firstSite.address");
  if (!trim(site.siteCode)) missing.push("firstSite.siteCode");
  // Per spec: each site must define a geofence radius (meters) used
  // by mobile clock-in proximity checks. Wizard defaults to 152m.
  const radiusMeters = Number(site.siteRadiusMeters);
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) missing.push("firstSite.siteRadiusMeters");
  const tax = (p.taxBilling ?? {}) as Record<string, unknown>;
  if (!trim(tax.federalTaxId)) missing.push("taxBilling.federalTaxId");
  if (!trim(tax.stateTaxId)) missing.push("taxBilling.stateTaxId");
  // Spec lists both physical AND billing addresses as must-haves.
  if (!trim(tax.physicalAddress)) missing.push("taxBilling.physicalAddress");
  if (!trim(tax.billingAddress)) missing.push("taxBilling.billingAddress");
  return missing;
}

function validateVendorPayload(p: Record<string, unknown>): string[] {
  const missing: string[] = [];
  const tax = (p.taxIds ?? {}) as Record<string, unknown>;
  if (!trim(tax.federalTaxId)) missing.push("taxIds.federalTaxId");
  if (!trim(tax.stateTaxId)) missing.push("taxIds.stateTaxId");
  if (!trim(tax.physicalAddress)) missing.push("taxIds.physicalAddress");
  if (!trim(tax.billingAddress)) missing.push("taxIds.billingAddress");
  // Service-Area-and-Work-Types step: require operating radius and at
  // least one valid work-type id (after coercion + dedupe). Garbage
  // input is dropped.
  const sa = (p.serviceArea ?? {}) as Record<string, unknown>;
  const radius = Number(sa.operatingRadiusMiles);
  if (!Number.isFinite(radius) || radius <= 0) missing.push("serviceArea.operatingRadiusMiles");
  const rawIds = Array.isArray(p.workTypeIds) ? (p.workTypeIds as unknown[]) : [];
  const validIds = Array.from(
    new Set(
      rawIds
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0),
    ),
  );
  if (validIds.length === 0) missing.push("workTypeIds");
  const ins = (p.compliance ?? {}) as Record<string, unknown>;
  if (!trim(ins.carrier)) missing.push("compliance.carrier");
  if (!trim(ins.policyNumber)) missing.push("compliance.policyNumber");
  if (!trim(ins.expirationDate)) missing.push("compliance.expirationDate");
  if (!trim(ins.documentUrl)) missing.push("compliance.documentUrl");
  const rates = (p.rates ?? {}) as Record<string, unknown>;
  if (rates.hourlyRate === undefined || rates.hourlyRate === null || rates.hourlyRate === "") missing.push("rates.hourlyRate");
  if (rates.dailyOtHours === undefined || rates.dailyOtHours === null || rates.dailyOtHours === "") missing.push("rates.dailyOtHours");
  if (rates.weeklyOtHours === undefined || rates.weeklyOtHours === null || rates.weeklyOtHours === "") missing.push("rates.weeklyOtHours");
  // Overtime multiplier required (per spec) — defaults to 1.50 in the
  // wizard, but persist whatever the user confirms.
  if (rates.overtimeMultiplier === undefined || rates.overtimeMultiplier === null || rates.overtimeMultiplier === "") {
    missing.push("rates.overtimeMultiplier");
  }
  // 1099 e-delivery consent: must be an explicit boolean (true OR
  // false). The wizard captures the user's choice; an absent value
  // means the question wasn't asked, which we don't allow.
  if (typeof p.eDeliveryConsent !== "boolean") missing.push("eDeliveryConsent");
  const emp = (p.firstEmployee ?? {}) as Record<string, unknown>;
  if (!trim(emp.firstName)) missing.push("firstEmployee.firstName");
  if (!trim(emp.lastName)) missing.push("firstEmployee.lastName");
  if (!trim(emp.email)) missing.push("firstEmployee.email");
  return missing;
}

router.post("/onboarding/:orgType/:orgId/complete", async (req: Request, res: Response): Promise<void> => {
  const orgType = req.params.orgType;
  const orgId = Number(req.params.orgId);
  if (orgType !== "partner" && orgType !== "vendor") {
    res.status(400).json({ error: "orgType must be partner or vendor", code: "onboarding.invalid_org_type" });
    return;
  }
  if (!Number.isFinite(orgId)) {
    res.status(400).json({ error: "orgId must be an integer", code: "onboarding.invalid_org_id" });
    return;
  }
  if (!authorizeOrgAccess(req, res, orgType, orgId)) return;
  const existing = await ensureProgressRow({
    orgType,
    partnerId: orgType === "partner" ? orgId : null,
    vendorId: orgType === "vendor" ? orgId : null,
    defaultStep: "done",
  });
  const payload = (existing.payload ?? {}) as Record<string, unknown>;

  if (orgType === "partner") {
    const missing = validatePartnerPayload(payload);
    if (missing.length > 0) {
      res.status(400).json({ error: "Required fields missing", code: "onboarding.required_fields_missing", missing });
      return;
    }
    const site = payload.firstSite as { name: string; address: string; siteCode: string; siteRadiusMeters: number | string };
    // Optional Preferences step (should-have). Only spread fields the
    // user actually filled — skipping the step leaves existing partner
    // values untouched.
    const prefs = (payload.preferences ?? {}) as Record<string, unknown>;
    const prefsPatch: { hoursOfOperation?: string; operatingRadiusMiles?: number } = {};
    if (typeof prefs.hoursOfOperation === "string" && prefs.hoursOfOperation.trim()) {
      prefsPatch.hoursOfOperation = prefs.hoursOfOperation.trim();
    }
    const prefRadius = Number(prefs.operatingRadiusMiles);
    if (Number.isFinite(prefRadius) && prefRadius > 0) {
      prefsPatch.operatingRadiusMiles = Math.round(prefRadius);
    }
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(partnersTable)
          .set({
            brandPrimaryColor: trim(payload.brandPrimaryColor),
            brandAccentColor: trim(payload.brandAccentColor),
            logoUrl: trim(payload.logoUrl),
            logoSquareUrl: trim(payload.logoSquareUrl),
            federalTaxId: trim((payload.taxBilling as Record<string, unknown>).federalTaxId),
            stateTaxId: trim((payload.taxBilling as Record<string, unknown>).stateTaxId),
            physicalAddress: trim((payload.taxBilling as Record<string, unknown>).physicalAddress),
            billingAddress: trim((payload.taxBilling as Record<string, unknown>).billingAddress),
            ...prefsPatch,
          })
          .where(eq(partnersTable.id, orgId));

        // Avoid duplicate site rows on resume → re-finish: if a site
        // with this code already exists for this partner, skip insert.
        const [existingSite] = await tx
          .select({ id: siteLocationsTable.id })
          .from(siteLocationsTable)
          .where(and(eq(siteLocationsTable.partnerId, orgId), eq(siteLocationsTable.siteCode, trim(site.siteCode))))
          .limit(1);
        if (!existingSite) {
          await tx.insert(siteLocationsTable).values({
            partnerId: orgId,
            name: trim(site.name),
            address: trim(site.address),
            // Geocoding is async/external — store 0/0 placeholder; a
            // background geocoder backfills lat/lng later.
            latitude: 0,
            longitude: 0,
            siteCode: trim(site.siteCode),
            siteRadiusMeters: Math.max(1, Math.round(Number(site.siteRadiusMeters))),
          });
        }
      });
    } catch (err) {
      logger.error({ err }, "completePartnerOnboarding failed");
      res.status(500).json({ error: "Failed to persist onboarding data", code: "onboarding.persist_failed" });
      return;
    }
  } else {
    const missing = validateVendorPayload(payload);
    if (missing.length > 0) {
      res.status(400).json({ error: "Required fields missing", code: "onboarding.required_fields_missing", missing });
      return;
    }
    const tax = payload.taxIds as Record<string, string>;
    const rates = payload.rates as Record<string, string | number>;
    const emp = payload.firstEmployee as Record<string, string>;
    const compliance = (payload.compliance ?? {}) as Record<string, string>;
    const serviceArea = (payload.serviceArea ?? {}) as Record<string, unknown>;
    const eDeliveryConsent = payload.eDeliveryConsent === true;
    // Vendor branding is a should-have step. Persist whatever the user
    // entered (or leave existing values intact if they skipped). Empty
    // strings are coerced to undefined so we don't blow away a logo
    // that's already configured for an existing vendor.
    const branding = (payload.branding ?? {}) as Record<string, string | undefined>;
    const brandingPatch: { brandPrimaryColor?: string; logoUrl?: string } = {};
    if (typeof branding.brandPrimaryColor === "string" && branding.brandPrimaryColor.trim()) {
      brandingPatch.brandPrimaryColor = branding.brandPrimaryColor.trim();
    }
    if (typeof branding.logoUrl === "string" && branding.logoUrl.trim()) {
      brandingPatch.logoUrl = branding.logoUrl.trim();
    }
    // Re-coerce + dedupe here so the DB write matches what the
    // validator counted. Anything non-numeric is dropped silently.
    const wtIds = Array.from(
      new Set(
        (payload.workTypeIds as unknown[])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0),
      ),
    );
    let firstEmployeeId: number | null = null;
    let firstEmployeeNeedsInvite = false;
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(vendorsTable)
          .set({
            federalTaxId: trim(tax.federalTaxId),
            stateTaxId: trim(tax.stateTaxId),
            physicalAddress: trim(tax.physicalAddress),
            billingAddress: trim(tax.billingAddress),
            // Service area: operating radius drives default vendor
            // matching for nearby partners. Lat/lng come from a
            // background geocoder once the address is set.
            operatingRadiusMiles: Math.max(1, Math.round(Number(serviceArea.operatingRadiusMiles) || 0)),
            dailyOtHours: String(rates.dailyOtHours),
            weeklyOtHours: String(rates.weeklyOtHours),
            overtimeMultiplier: String(rates.overtimeMultiplier),
            // 1099 e-delivery consent. When true, also stamp the
            // consent timestamp for IRS audit trail (Pub 1179 §31.6051-1(j)).
            eDeliveryConsent,
            eDeliveryConsentAt: eDeliveryConsent ? new Date() : null,
            // Persist Compliance step canonically so partner-facing COI
            // expiration reports + admin audits can read it without
            // dipping into onboarding_progress.payload.
            insuranceCarrier: trim(compliance.carrier),
            insurancePolicyNumber: trim(compliance.policyNumber),
            insuranceExpirationDate: trim(compliance.expirationDate),
            coiDocumentUrl: trim(compliance.documentUrl),
            // Spread in optional vendor branding only if the user
            // actually filled it. Skipping the step leaves existing
            // values untouched.
            ...brandingPatch,
          })
          .where(eq(vendorsTable.id, orgId));

        // Replace the vendor's selected work types: delete existing
        // mapping rows then insert the new set. Idempotent on resume.
        await tx.delete(vendorWorkTypesTable).where(eq(vendorWorkTypesTable.vendorId, orgId));
        if (wtIds.length > 0) {
          await tx
            .insert(vendorWorkTypesTable)
            .values(wtIds.map((workTypeId) => ({ vendorId: orgId, workTypeId })));
        }

        // First employee: insert if no row with same email already
        // exists for this vendor (resume safety).
        const cleanEmp = trim(emp.email).toLowerCase();
        const [existingEmp] = await tx
          .select({ id: vendorPeopleTable.id, inviteToken: vendorPeopleTable.inviteToken, userId: vendorPeopleTable.userId })
          .from(vendorPeopleTable)
          .where(and(eq(vendorPeopleTable.vendorId, orgId), sql`lower(${vendorPeopleTable.email}) = ${cleanEmp}`))
          .limit(1);
        if (existingEmp) {
          firstEmployeeId = existingEmp.id;
          // Already-invited or already-onboarded → skip auto-invite.
          firstEmployeeNeedsInvite = !existingEmp.userId && !existingEmp.inviteToken;
        } else {
          const [created] = await tx
            .insert(vendorPeopleTable)
            .values({
              vendorId: orgId,
              vendorRole: "field",
              firstName: trim(emp.firstName),
              lastName: trim(emp.lastName),
              email: cleanEmp,
              phone: trim(emp.phone) || null,
              hourlyRate: String(rates.hourlyRate),
            })
            .returning({ id: vendorPeopleTable.id });
          firstEmployeeId = created.id;
          firstEmployeeNeedsInvite = true;
        }
      });
    } catch (err) {
      logger.error({ err }, "completeVendorOnboarding failed");
      res.status(500).json({ error: "Failed to persist onboarding data", code: "onboarding.persist_failed" });
      return;
    }

    // Issue + email the onboarding invite outside the transaction so a
    // SendGrid hiccup doesn't roll back canonical writes. Best-effort:
    // helper logs+swallows email failures; admin can re-issue from the
    // employees screen.
    if (firstEmployeeId !== null && firstEmployeeNeedsInvite) {
      try {
        await issueAndEmailFieldInvite(firstEmployeeId);
      } catch (err) {
        logger.warn({ err, firstEmployeeId }, "Auto-invite for first employee failed");
      }
    }
  }

  const [updated] = await db
    .update(onboardingProgressTable)
    .set({ completedAt: new Date() })
    .where(eq(onboardingProgressTable.id, existing.id))
    .returning();
  res.json(serializeProgress(updated));
});

// ─────────────────────────────────────────────────────────────────
// Bug #5 fix: partner-contact magic-link invite. Mirrors the
// field-employee invite flow above so a partner admin can issue a
// password-set link to an AP contact (or any partner contact) and
// have them auto-provisioned as a partner-side user on accept.
// ─────────────────────────────────────────────────────────────────
async function issueAndEmailPartnerContactInvite(contactId: number): Promise<{ token: string; url: string; emailSent: boolean }> {
  const token = crypto.randomBytes(24).toString("hex");
  await db
    .update(partnerContactsTable)
    .set({ inviteToken: token, inviteSentAt: new Date(), acceptedAt: null })
    .where(eq(partnerContactsTable.id, contactId));

  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  const url = `${baseUrl}/onboarding/partner-contact/${token}`;

  const [contact] = await db
    .select({ email: partnerContactsTable.email, name: partnerContactsTable.name, partnerId: partnerContactsTable.partnerId })
    .from(partnerContactsTable)
    .where(eq(partnerContactsTable.id, contactId))
    .limit(1);

  let emailSent = false;
  if (contact?.email) {
    try {
      const [partner] = await db
        .select({ name: partnersTable.name })
        .from(partnersTable)
        .where(eq(partnersTable.id, contact.partnerId))
        .limit(1);
      const orgName = partner?.name ?? "your organization";
      const firstName = contact.name.split(" ")[0] ?? contact.name;
      const { getUncachableSendGridClient } = await import("../lib/sendgrid");
      const { client, fromEmail } = await getUncachableSendGridClient();
      await client.send({
        to: contact.email,
        from: fromEmail,
        subject: `Set up your VNDRLY login for ${orgName}`,
        text: `Hi ${firstName},\n\n${orgName} invited you to manage your VNDRLY account. Tap the link below to set your password:\n\n${url}\n\nThe link expires once you've completed setup.`,
        html: `<p>Hi ${firstName},</p><p>${orgName} invited you to manage your VNDRLY account. Tap the link below to set your password:</p><p><a href="${url}">${url}</a></p><p>The link expires once you've completed setup.</p>`,
      });
      emailSent = true;
    } catch (err) {
      logger.warn({ err, contactId }, "Failed to email partner-contact onboarding invite");
    }
  }

  return { token, url, emailSent };
}

router.post("/partners/:partnerId/contacts/:contactId/invite", async (req: Request, res: Response): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const partnerId = Number(req.params.partnerId);
  const contactId = Number(req.params.contactId);
  if (!Number.isFinite(partnerId) || !Number.isFinite(contactId)) {
    res.status(400).json({ error: "Invalid id", code: "onboarding.invalid_id" });
    return;
  }
  const isPlatformAdmin = session.role === "admin";
  const isOwningPartnerAdmin =
    session.role === "partner" && session.membershipRole === "admin" && session.partnerId === partnerId;
  if (!isPlatformAdmin && !isOwningPartnerAdmin) {
    res.status(403).json({ error: "Admin or partner admin access required", code: "auth.admin_or_partner_admin_required" });
    return;
  }
  const [contact] = await db
    .select()
    .from(partnerContactsTable)
    .where(and(eq(partnerContactsTable.id, contactId), isNull(partnerContactsTable.deletedAt)))
    .limit(1);
  if (!contact || contact.partnerId !== partnerId) {
    res.status(404).json({ error: "Contact not found", code: "partner_contact.not_found" });
    return;
  }
  if (contact.userId) {
    res.status(409).json({ error: "Contact already has a login", code: "partner_contact.already_provisioned" });
    return;
  }
  const { token, url, emailSent } = await issueAndEmailPartnerContactInvite(contactId);
  res.json({ contactId, token, url, emailSent });
});

router.get("/onboarding/partner-contact/by-token/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token || token.length < 16) {
    res.status(404).json({ error: "Invalid token", code: "auth.invalid_token" });
    return;
  }
  const [contact] = await db
    .select()
    .from(partnerContactsTable)
    .where(and(eq(partnerContactsTable.inviteToken, token), isNull(partnerContactsTable.deletedAt)))
    .limit(1);
  if (!contact) {
    res.status(404).json({ error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  if (contact.acceptedAt || contact.userId) {
    res.status(409).json({ error: "Invite already used", code: "auth.invite_already_used" });
    return;
  }
  const [partner] = await db
    .select({ name: partnersTable.name })
    .from(partnersTable)
    .where(eq(partnersTable.id, contact.partnerId))
    .limit(1);
  res.json({
    contactId: contact.id,
    partnerId: contact.partnerId,
    partnerName: partner?.name ?? null,
    name: contact.name,
    email: contact.email,
    jobTitle: contact.jobTitle,
    roles: contact.roles,
    preferredLocale: contact.preferredLocale,
  });
});

router.post("/onboarding/partner-contact/by-token/:token/accept", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token || token.length < 16) {
    res.status(404).json({ error: "Invalid token", code: "auth.invalid_token" });
    return;
  }
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters", code: "auth.password_too_short" });
    return;
  }
  const [contact] = await db
    .select()
    .from(partnerContactsTable)
    .where(and(eq(partnerContactsTable.inviteToken, token), isNull(partnerContactsTable.deletedAt)))
    .limit(1);
  if (!contact) {
    res.status(404).json({ error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  if (contact.acceptedAt || contact.userId) {
    res.status(409).json({ error: "Invite already used", code: "auth.invite_already_used" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const emailLower = contact.email.toLowerCase();

  const result = await db.transaction(async (tx) => {
    // Reuse existing user row if the email is already registered (e.g. the
    // contact also holds a vendor login). Otherwise create one.
    const [existingUser] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, emailLower))
      .limit(1);
    let user = existingUser;
    if (!user) {
      const [created] = await tx
        .insert(usersTable)
        .values({
          username: emailLower,
          email: emailLower,
          passwordHash,
          displayName: contact.name,
          role: "partner",
        })
        .returning();
      user = created;
    } else {
      await tx
        .update(usersTable)
        .set({ passwordHash })
        .where(eq(usersTable.id, user.id));
    }
    const membershipId = await addMembership(
      { userId: user.id, orgType: "partner", orgId: contact.partnerId, role: "admin" },
      tx,
    );
    await tx
      .update(partnerContactsTable)
      .set({ userId: user.id, acceptedAt: new Date(), inviteToken: null })
      .where(eq(partnerContactsTable.id, contact.id));
    return { user, membershipId };
  });

  // Sign them in immediately by issuing a session cookie — same shape as
  // the rest of onboarding's auto-login flows.
  const cookieValue = buildSessionCookie({
    user: result.user,
    membershipId: result.membershipId,
    role: "partner",
    membershipRole: "admin",
    partnerId: contact.partnerId,
    vendorId: null,
    vendorPeopleId: null,
  });
  res.cookie(COOKIE_NAME, cookieValue, COOKIE_OPTIONS);
  res.json({
    contactId: contact.id,
    userId: result.user.id,
    partnerId: contact.partnerId,
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /field-employees/:id/onboarding-invite
// Generates (or rotates) the invite token and emails the link.
// ─────────────────────────────────────────────────────────────────
router.post("/field-employees/:id/onboarding-invite", async (req: Request, res: Response): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  // Only platform admins or vendor *admins* may issue an invite — a
  // regular vendor member shouldn't be able to mint tokenized links
  // for accounts they don't own.
  const isPlatformAdmin = session.role === "admin";
  const isVendorAdmin = session.role === "vendor" && session.membershipRole === "admin";
  if (!isPlatformAdmin && !isVendorAdmin) {
    res.status(403).json({ error: "Admin or vendor admin access required", code: "auth.admin_or_vendor_admin_required" });
    return;
  }
  const employeeId = Number(req.params.id);
  if (!Number.isFinite(employeeId)) {
    res.status(400).json({ error: "id must be an integer", code: "onboarding.invalid_id" });
    return;
  }
  const [employee] = await db
    .select()
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.id, employeeId), isNull(vendorPeopleTable.deletedAt)))
    .limit(1);
  if (!employee) {
    res.status(404).json({ error: "Employee not found", code: "employee.not_found" });
    return;
  }
  if (session.role === "vendor" && session.vendorId !== employee.vendorId) {
    res.status(403).json({ error: "Cannot manage employees outside your vendor", code: "onboarding.employee_vendor_mismatch" });
    return;
  }
  const { token, url, emailSent } = await issueAndEmailFieldInvite(employeeId);
  res.json({ employeeId, token, url, emailSent });
});

// ─────────────────────────────────────────────────────────────────
// GET /onboarding/field/by-token/:token — public token resolution
// ─────────────────────────────────────────────────────────────────
router.get("/onboarding/field/by-token/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token || token.length < 16) {
    res.status(404).json({ error: "Invalid token", code: "auth.invalid_token" });
    return;
  }
  const [employee] = await db
    .select()
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.inviteToken, token), isNull(vendorPeopleTable.deletedAt)))
    .limit(1);
  if (!employee) {
    res.status(404).json({ error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  const [vendor] = await db
    .select({ name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, employee.vendorId))
    .limit(1);
  const progress = await ensureProgressRow({
    orgType: "field_employee",
    vendorPeopleId: employee.id,
    defaultStep: "personal-info",
  });
  res.json({
    vendorPeopleId: employee.id,
    vendorId: employee.vendorId,
    vendorName: vendor?.name ?? "your employer",
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone ?? null,
    photoUrl: employee.photoUrl ?? null,
    // Mirrored back so the wizard's English/Español toggle reflects
    // whatever the invitee picked on a previous visit. `null` until
    // they touch the toggle for the first time.
    preferredLanguage: (employee.preferredLanguage === "en" || employee.preferredLanguage === "es")
      ? employee.preferredLanguage
      : null,
    progress: serializeProgress(progress),
  });
});

// ─────────────────────────────────────────────────────────────────
// PUT /onboarding/field/by-token/:token/language
// Public; lets the (still-anonymous) invitee persist the
// English/Español toggle to `vendor_people.preferred_language` so
// the token-mode assistant can prime in the right language from
// the very first message — *before* a `users` row exists.
// ─────────────────────────────────────────────────────────────────
router.put("/onboarding/field/by-token/:token/language", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token || token.length < 16) {
    res.status(404).json({ error: "Invalid token", code: "auth.invalid_token" });
    return;
  }
  // Accept "en" | "es" | null (explicit clear). Anything else is a
  // 400 so the client can't silently set garbage values that would
  // then cause the assistant to fall back to English.
  const raw = req.body?.preferredLanguage;
  let next: "en" | "es" | null;
  if (raw === "en" || raw === "es") {
    next = raw;
  } else if (raw === null) {
    next = null;
  } else {
    res.status(400).json({ error: "preferredLanguage must be 'en', 'es', or null", code: "onboarding.invalid_preferred_language" });
    return;
  }
  const [employee] = await db
    .select()
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.inviteToken, token), isNull(vendorPeopleTable.deletedAt)))
    .limit(1);
  if (!employee) {
    res.status(404).json({ error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  await db
    .update(vendorPeopleTable)
    .set({ preferredLanguage: next })
    .where(eq(vendorPeopleTable.id, employee.id));
  res.json({ preferredLanguage: next });
});

// ─────────────────────────────────────────────────────────────────
// POST /onboarding/field/by-token/:token/upload-url
// POST /onboarding/field/by-token/:token/upload-finalize
//
// Tokenised upload endpoints used during anonymous field-employee
// onboarding so the invitee can upload their profile photo before
// they have a real session. The token itself is the authentication
// material — a valid, un-expired invite token bound to an undeleted
// vendor_people row is required. The uploaded object is stamped
// "public" (i.e. readable by any authenticated app session), which
// is the same posture used for org-shared employee photos uploaded
// from the web app via /storage/uploads/finalize.
// ─────────────────────────────────────────────────────────────────
async function loadFieldEmployeeByToken(token: string) {
  if (!token || token.length < 16) return null;
  const [employee] = await db
    .select()
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.inviteToken, token), isNull(vendorPeopleTable.deletedAt)))
    .limit(1);
  return employee ?? null;
}

router.post("/onboarding/field/by-token/:token/upload-url", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  const employee = await loadFieldEmployeeByToken(token);
  if (!employee) {
    res.status(404).json({ error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  try {
    const uploadURL = await onboardingObjectStorageService.getObjectEntityUploadURL();
    const objectPath = onboardingObjectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (error) {
    logger.error({ err: error }, "Error generating onboarding upload URL");
    res.status(500).json({ error: "Failed to generate upload URL", code: "onboarding.generate_upload_url_failed" });
  }
});

router.post("/onboarding/field/by-token/:token/upload-finalize", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  const employee = await loadFieldEmployeeByToken(token);
  if (!employee) {
    res.status(404).json({ error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  const objectURL = String(req.body?.objectURL ?? "");
  if (!objectURL) {
    res.status(400).json({ error: "objectURL is required", code: "onboarding.object_url_required" });
    return;
  }
  try {
    const objectPath = await onboardingObjectStorageService.trySetObjectEntityAclPolicy(objectURL, {
      // Owner is the invite token's vendor_people row — once the user
      // completes onboarding their userId will be linked to this row,
      // and the object stays readable to any authenticated session.
      owner: `vendor_people:${employee.id}`,
      visibility: "public",
    });
    res.json({ objectPath });
  } catch (error) {
    logger.error({ err: error }, "Error finalizing onboarding upload ACL");
    res.status(500).json({ error: "Failed to finalize upload", code: "onboarding.finalize_upload_failed" });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /onboarding/field/by-token/:token/progress
// Public; lets the (still-anonymous) field employee persist their
// next/skip step transitions before they finish setting their
// password. Authenticated by the same token used to load the form.
// ─────────────────────────────────────────────────────────────────
router.put("/onboarding/field/by-token/:token/progress", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token || token.length < 16) {
    res.status(404).json({ error: "Invalid token", code: "auth.invalid_token" });
    return;
  }
  const [employee] = await db
    .select()
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.inviteToken, token), isNull(vendorPeopleTable.deletedAt)))
    .limit(1);
  if (!employee) {
    res.status(404).json({ error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  const parsed = UpdateOnboardingProgressBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const row = await ensureProgressRow({
    orgType: "field_employee",
    vendorPeopleId: employee.id,
    defaultStep: "personal-info",
  });
  const updated = await applyProgressPatch(row, parsed.data);
  res.json(serializeProgress(updated));
});

// ─────────────────────────────────────────────────────────────────
// POST /onboarding/field/by-token/:token/complete
// Public; creates user, clears token, sets session cookie.
// ─────────────────────────────────────────────────────────────────
router.post("/onboarding/field/by-token/:token/complete", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (!token || token.length < 16) {
    res.status(404).json({ error: "Invalid token", code: "auth.invalid_token" });
    return;
  }
  const parsed = CompleteFieldOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const { firstName, lastName, phone, photoUrl, password, preferredLanguage, pecCertification, pecExpirationDate, vendorRole } = parsed.data;

  // Server-side enforcement of field-employee must-haves. The wizard
  // mirrors this so users get inline errors, but we re-validate here
  // so the API can't be bypassed.
  const ALLOWED_ROLES = new Set(["field", "foreman", "office", "both"]);
  const fieldMissing: string[] = [];
  if (!firstName?.trim()) fieldMissing.push("firstName");
  if (!lastName?.trim()) fieldMissing.push("lastName");
  if (!phone?.trim()) fieldMissing.push("phone");
  if (!photoUrl?.trim()) fieldMissing.push("photoUrl");
  if (pecCertification !== true) fieldMissing.push("pecCertification");
  if (!pecExpirationDate?.trim()) fieldMissing.push("pecExpirationDate");
  if (!vendorRole || !ALLOWED_ROLES.has(vendorRole)) fieldMissing.push("vendorRole");
  if (fieldMissing.length > 0) {
    res.status(400).json({ error: "Required fields missing", code: "onboarding.required_fields_missing", missing: fieldMissing });
    return;
  }

  const [employee] = await db
    .select()
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.inviteToken, token), isNull(vendorPeopleTable.deletedAt)))
    .limit(1);
  if (!employee) {
    res.status(404).json({ error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  const cleanEmail = employee.email.trim().toLowerCase();
  const [emailConflict] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = ${cleanEmail}`)
    .limit(1);
  if (emailConflict && employee.userId !== emailConflict.id) {
    res.status(409).json({ error: "That email is already in use by another login.", code: "onboarding.email_taken_by_another_login" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await db.transaction(async (tx) => {
      let userId = employee.userId;
      if (userId) {
        await tx
          .update(usersTable)
          .set({
            passwordHash,
            displayName: `${firstName} ${lastName}`.trim() || cleanEmail,
            preferredLanguage: preferredLanguage ?? null,
            role: "field_employee",
          })
          .where(eq(usersTable.id, userId));
      } else {
        const [newUser] = await tx
          .insert(usersTable)
          .values({
            username: cleanEmail,
            email: cleanEmail,
            passwordHash,
            role: "field_employee",
            displayName: `${firstName} ${lastName}`.trim() || cleanEmail,
            preferredLanguage: preferredLanguage ?? null,
          })
          .returning();
        userId = newUser.id;
      }
      const empUpdates: Partial<typeof vendorPeopleTable.$inferInsert> = {
        firstName,
        lastName,
        phone: phone ?? null,
        photoUrl: photoUrl ?? null,
        vendorRole,
        userId,
        inviteToken: null,
        inviteSentAt: null,
        // Mirror the chosen language onto the vendor_people row as
        // well so the column stays meaningful even after the invite
        // token is cleared (and the user row is the canonical source
        // of truth post-auth). Keeps token-mode and post-auth in sync.
        preferredLanguage: preferredLanguage ?? null,
      };
      if (pecCertification !== undefined && pecCertification !== null) empUpdates.pecCertification = pecCertification;
      if (pecExpirationDate !== undefined) empUpdates.pecExpirationDate = pecExpirationDate ?? null;
      await tx
        .update(vendorPeopleTable)
        .set(empUpdates)
        .where(eq(vendorPeopleTable.id, employee.id));
      // Insert the membership row in the same transaction so a brand-
      // new field-employee login is never visible without the matching
      // `user_org_memberships` row.
      const membershipId = await addMembership(
        {
          userId: userId!,
          orgType: "vendor",
          orgId: employee.vendorId,
          role: "field_employee",
          vendorPeopleId: employee.id,
        },
        tx,
      );
      return { userId, membershipId };
    });

    const { membershipId } = result;

    // Mark progress complete.
    const [existing] = await db
      .select()
      .from(onboardingProgressTable)
      .where(eq(onboardingProgressTable.vendorPeopleId, employee.id))
      .limit(1);
    let progress = existing;
    if (progress) {
      const [updated] = await db
        .update(onboardingProgressTable)
        .set({ completedAt: new Date(), currentStep: "done" })
        .where(eq(onboardingProgressTable.id, progress.id))
        .returning();
      progress = updated;
    } else {
      [progress] = await db
        .insert(onboardingProgressTable)
        .values({
          orgType: "field_employee",
          vendorPeopleId: employee.id,
          currentStep: "done",
          completedAt: new Date(),
          completedSteps: ["personal-info", "photo-certs", "set-password"],
          skippedSteps: [],
          payload: {},
        })
        .returning();
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, result.userId!)).limit(1);
    const cookie = buildSessionCookie({
      user,
      membershipId,
      role: "field_employee",
      membershipRole: "field_employee",
      partnerId: null,
      vendorId: employee.vendorId,
      vendorPeopleId: employee.id,
    });
    res.cookie(COOKIE_NAME, cookie, COOKIE_OPTIONS);
    res.json({
      orgType: "field_employee",
      orgId: employee.id,
      userId: result.userId!,
      progress: serializeProgress(progress!),
    });
  } catch (err) {
    logger.error({ err }, "completeFieldOnboarding failed");
    res.status(500).json({ error: "Failed to complete onboarding", code: "onboarding.complete_failed" });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /onboarding/refer — any logged-in user can email a friend the
// public /signup link to start their own org's onboarding (vendor or
// partner). Field-employee invites still flow through the dedicated
// vendor-people endpoint above so the recipient lands on a tokenised
// flow tied to a real vendor_people row.
// ─────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/onboarding/refer", async (req: Request, res: Response): Promise<void> => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }

  const email = trim((req.body as { email?: unknown })?.email).toLowerCase();
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    res
      .status(400)
      .json({ error: "Valid email required", code: "onboarding.refer_invalid_email" });
    return;
  }

  const baseUrl =
    process.env.APP_BASE_URL ||
    `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  const url = `${baseUrl}/signup`;

  const referrerName =
    (await db
      .select({ displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.id, session.userId!))
      .limit(1))[0]?.displayName ?? "A teammate";

  // Escape user-controlled and URL strings before HTML interpolation
  // to prevent HTML/phishing injection in outbound invite emails.
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const safeName = escapeHtml(referrerName);
  const safeUrl = escapeHtml(url);

  try {
    const { getUncachableSendGridClient } = await import("../lib/sendgrid");
    const { client, fromEmail } = await getUncachableSendGridClient();
    await client.send({
      to: email,
      from: fromEmail,
      subject: "You're invited to join VNDRLY",
      text: `Hi,\n\n${referrerName} invited you to join VNDRLY — a field-operations platform for oil & gas partners and vendors.\n\nGet started here:\n${url}\n\nYou'll be able to choose whether to onboard your organization as a vendor or as a partner.`,
      html: `<p>Hi,</p><p><strong>${safeName}</strong> invited you to join VNDRLY — a field-operations platform for oil &amp; gas partners and vendors.</p><p>Get started here: <a href="${safeUrl}">${safeUrl}</a></p><p>You'll be able to choose whether to onboard your organization as a vendor or as a partner.</p>`,
    });
    res.json({ ok: true, sentTo: email });
  } catch (err) {
    logger.warn({ err, email, referrerId: session.userId }, "refer-to-vndrly: email send failed");
    res
      .status(503)
      .json({ error: "Email service unavailable", code: "onboarding.refer_send_failed" });
  }
});

export default router;
