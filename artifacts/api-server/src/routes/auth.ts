import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  vendorPeopleTable,
  userOrgMembershipsTable,
  partnersTable,
  vendorsTable,
  invoicesTable,
  invoiceLinesTable,
  invoicePaymentsTable,
  reportExportAuditLogTable,
} from "@workspace/db";
import { eq, sql, and, isNull, asc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { DEMO_USERS } from "../lib/demo-users";
import { logger } from "../lib/logger";
import { SESSION_SECRET } from "../lib/session";
import { loginBrandQueryFromContext } from "../lib/loginBrandQuery";

const router = Router();

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

function normalizeLanguage(
  value: string | null | undefined,
): "en" | "es" | "pt" | null {
  if (value === "en" || value === "es" || value === "pt") return value;
  return null;
}

/**
 * Pick a seed language ("en" or "es") from a client-reported locale signal:
 *
 *   - `clientLocale` — the OS locale the mobile app passes in the login body
 *     via `expo-localization` (e.g. "es-MX", "en-US").
 *   - `acceptLanguage` — the standard browser-supplied `Accept-Language`
 *     header for web clients (e.g. "es-MX,es;q=0.9,en;q=0.8").
 *
 * Per Task #837 we only ever auto-seed `en` or `es`; any other base language
 * (or no signal at all) falls back to `en`. Returns `null` only when both
 * inputs are empty/missing — that lets the caller skip the DB write entirely
 * for legacy callers that send no locale signal.
 */
export function pickAutoSeedLanguage(
  clientLocale: string | null | undefined,
  acceptLanguage: string | null | undefined,
): "en" | "es" | null {
  const candidates: string[] = [];
  if (typeof clientLocale === "string" && clientLocale.trim()) {
    candidates.push(clientLocale.trim());
  }
  if (typeof acceptLanguage === "string" && acceptLanguage.trim()) {
    // Accept-Language is a comma-separated list of language tags with
    // optional `;q=` quality values. We don't bother sorting by `q` —
    // browsers already list the user's preferred language first.
    for (const part of acceptLanguage.split(",")) {
      const tag = part.split(";")[0]?.trim();
      if (tag) candidates.push(tag);
    }
  }
  if (candidates.length === 0) return null;
  for (const tag of candidates) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  // We had a signal but it was for a language we don't support — fall back
  // to English rather than leaving `preferred_language` null forever.
  return "en";
}

function verifyPayload(signed: string): string | null {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  return payload;
}

type MembershipRole = "admin" | "member" | "field_employee";

interface MembershipSummary {
  id: number;
  orgType: "partner" | "vendor";
  orgId: number;
  orgName: string;
  orgLogoUrl: string | null;
  /** In-org role for this membership (admin/member/field_employee). */
  role: MembershipRole;
  vendorPeopleId: number | null;
}

/**
 * Map an active membership's `orgType` to the session role used by the
 * frontend / authorization checks (partner portal vs vendor portal vs
 * field portal). Field-employee status is determined by membership.role,
 * NOT by orgType, so a vendor membership with role="field_employee"
 * resolves to session role "field_employee".
 */
function deriveSessionRole(orgType: "partner" | "vendor", membershipRole: MembershipRole): "partner" | "vendor" | "field_employee" {
  if (membershipRole === "field_employee") return "field_employee";
  return orgType;
}

interface ResolvedContext {
  activeMembershipId: number | null;
  role: string;
  /** The user's role within their active org membership (admin/member/field_employee). Null for system admins with no membership. */
  membershipRole: string | null;
  partnerId: number | null;
  vendorId: number | null;
  vendorRole: string | null;
  vendorPeopleId: number | null;
  availableMemberships: MembershipSummary[];
}

/**
 * Load every membership for the user, hydrate org name/logo, and pick the
 * active one (preferring `users.activeMembershipId`, else the first one in
 * insertion order). `user_org_memberships` is the single source of truth.
 * Users with no memberships (system admins, or a field-employee user whose
 * vendor_people row pre-dates the memberships model) fall back to a
 * derivation from `users.role` + their vendor_people row so existing
 * behavior is preserved.
 */
async function resolveContext(user: typeof usersTable.$inferSelect): Promise<ResolvedContext> {
  const rows = await db
    .select({
      id: userOrgMembershipsTable.id,
      orgType: userOrgMembershipsTable.orgType,
      partnerId: userOrgMembershipsTable.partnerId,
      vendorId: userOrgMembershipsTable.vendorId,
      role: userOrgMembershipsTable.role,
      vendorPeopleId: userOrgMembershipsTable.vendorPeopleId,
      partnerName: partnersTable.name,
      partnerLogoUrl: partnersTable.logoUrl,
      vendorName: vendorsTable.name,
      vendorLogoUrl: vendorsTable.logoUrl,
    })
    .from(userOrgMembershipsTable)
    .leftJoin(partnersTable, eq(partnersTable.id, userOrgMembershipsTable.partnerId))
    .leftJoin(vendorsTable, eq(vendorsTable.id, userOrgMembershipsTable.vendorId))
    .where(eq(userOrgMembershipsTable.userId, user.id))
    .orderBy(asc(userOrgMembershipsTable.id));

  const memberships: MembershipSummary[] = rows
    .map((r): MembershipSummary | null => {
      const orgType: "partner" | "vendor" | null =
        r.orgType === "partner" ? "partner" : r.orgType === "vendor" ? "vendor" : null;
      if (!orgType) return null;
      const orgId = orgType === "partner" ? r.partnerId : r.vendorId;
      const orgName = orgType === "partner" ? r.partnerName : r.vendorName;
      const orgLogoUrl = orgType === "partner" ? r.partnerLogoUrl : r.vendorLogoUrl;
      if (!orgId) return null;
      const role: MembershipRole =
        r.role === "admin" || r.role === "field_employee" ? r.role : "member";
      return {
        id: r.id,
        orgType,
        orgId,
        orgName: orgName ?? `${orgType === "partner" ? "Partner" : "Vendor"} #${orgId}`,
        orgLogoUrl: orgLogoUrl ?? null,
        role,
        vendorPeopleId: r.vendorPeopleId ?? null,
      };
    })
    .filter((x): x is MembershipSummary => x !== null);

  if (memberships.length === 0) {
    // No-membership path: system admins (no org) and orphan field
    // employees whose vendor_people row was created before they got a
    // membership. Partner/vendor users always have a membership row, so
    // there is no partner fallback here.
    let vendorRole: string | null = null;
    let vendorPeopleId: number | null = null;
    let resolvedVendorId: number | null = null;
    if (user.role === "field_employee") {
      const [vp] = await db
        .select({
          id: vendorPeopleTable.id,
          vendorId: vendorPeopleTable.vendorId,
          vendorRole: vendorPeopleTable.vendorRole,
        })
        .from(vendorPeopleTable)
        .where(and(eq(vendorPeopleTable.userId, user.id), isNull(vendorPeopleTable.deletedAt)));
      if (vp) {
        vendorRole = vp.vendorRole ?? null;
        vendorPeopleId = vp.id;
        resolvedVendorId = vp.vendorId;
      }
    }
    return {
      activeMembershipId: null,
      role: user.role,
      membershipRole: null,
      partnerId: null,
      vendorId: resolvedVendorId,
      vendorRole,
      vendorPeopleId,
      availableMemberships: [],
    };
  }

  const preferred =
    memberships.find((m) => m.id === user.activeMembershipId) ?? memberships[0];

  // Hydrate vendorRole from the linked vendor_people row whenever the
  // active membership lives on the vendor side — both for field-employee
  // memberships (so foreman/field resolution keeps working) AND for
  // vendor memberships generally (so the web UI can decide whether to
  // surface office-only affordances like phone intake — Task #498). If
  // the membership row is missing the vendorPeopleId link (legacy data
  // that pre-dates the backfill), fall back to a lookup by userId +
  // vendorId so we never serve a half-broken vendor session.
  let vendorRole: string | null = null;
  let resolvedVendorPeopleId: number | null = preferred.vendorPeopleId;
  if (preferred.orgType === "vendor") {
    if (resolvedVendorPeopleId) {
      const [vp] = await db
        .select({ vendorRole: vendorPeopleTable.vendorRole })
        .from(vendorPeopleTable)
        .where(eq(vendorPeopleTable.id, resolvedVendorPeopleId));
      vendorRole = vp?.vendorRole ?? null;
    } else {
      const [vp] = await db
        .select({
          id: vendorPeopleTable.id,
          vendorRole: vendorPeopleTable.vendorRole,
        })
        .from(vendorPeopleTable)
        .where(
          and(
            eq(vendorPeopleTable.userId, user.id),
            eq(vendorPeopleTable.vendorId, preferred.orgId),
            isNull(vendorPeopleTable.deletedAt),
          ),
        )
        .limit(1);
      if (vp) {
        resolvedVendorPeopleId = vp.id;
        vendorRole = vp.vendorRole ?? null;
      }
    }
  }

  return {
    activeMembershipId: preferred.id,
    role: deriveSessionRole(preferred.orgType, preferred.role),
    membershipRole: preferred.role,
    partnerId: preferred.orgType === "partner" ? preferred.orgId : null,
    vendorId: preferred.orgType === "vendor" ? preferred.orgId : null,
    vendorRole,
    vendorPeopleId: resolvedVendorPeopleId,
    availableMemberships: memberships,
  };
}

function buildSessionCookie(user: typeof usersTable.$inferSelect, ctx: ResolvedContext): string {
  const nowSecs = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      userId: user.id,
      role: ctx.role,
      membershipRole: ctx.membershipRole,
      displayName: user.displayName,
      partnerId: ctx.partnerId,
      vendorId: ctx.vendorId,
      vendorRole: ctx.vendorRole,
      vendorPeopleId: ctx.vendorPeopleId,
      activeMembershipId: ctx.activeMembershipId,
      iat: nowSecs,
      exp: nowSecs + SESSION_TTL_SECS,
      sv: user.sessionVersion ?? 1,
    }),
  ).toString("base64");
  return signPayload(payload);
}

router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required",
        code: "auth.missing_credentials",
      });
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) = lower(${username})`)
      .limit(1);

    if (!user) {
      return res.status(401).json({
        message: "Invalid username or password",
        code: "auth.invalid_credentials",
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({
        message: "Invalid username or password",
        code: "auth.invalid_credentials",
      });
    }

    // Suspended users (admin set users.suspended_at) cannot sign in.
    // Distinct error code so the frontend can show a tailored message.
    if (user.suspendedAt) {
      return res.status(403).json({
        message: "This account has been suspended. Please contact your administrator.",
        code: "auth.suspended",
      });
    }

    const ctx = await resolveContext(user);

    // Decide whether to auto-persist the chosen active membership. For
    // first-time login of a dual-role user (activeMembershipId is null
    // AND they have 2+ memberships) we keep the DB column null so the
    // frontend knows to show the post-login "Choose your view" picker.
    // The session still gets a sensible default context so every API
    // route works even before the user picks one.
    const requiresContextChoice =
      user.activeMembershipId === null && ctx.availableMemberships.length >= 2;

    if (
      !requiresContextChoice &&
      ctx.activeMembershipId &&
      ctx.activeMembershipId !== user.activeMembershipId
    ) {
      // Persist the auto-selected active membership so the next visit
      // resumes the same context.
      await db
        .update(usersTable)
        .set({ activeMembershipId: ctx.activeMembershipId })
        .where(eq(usersTable.id, user.id));
    }

    const signed = buildSessionCookie(user, ctx);
    res.cookie(COOKIE_NAME, signed, COOKIE_OPTIONS);

    let preferredLanguage = normalizeLanguage(user.preferredLanguage);

    // Task #837: auto-seed `users.preferred_language` from the client's
    // reported locale on first login. Explicit picks (anything non-null
    // already in the column) always win — this branch is one-shot.
    if (preferredLanguage === null) {
      const clientLocale =
        typeof req.body?.clientLocale === "string" ? req.body.clientLocale : null;
      const acceptLanguage =
        typeof req.headers["accept-language"] === "string"
          ? (req.headers["accept-language"] as string)
          : null;
      const seeded = pickAutoSeedLanguage(clientLocale, acceptLanguage);
      if (seeded) {
        await db
          .update(usersTable)
          .set({ preferredLanguage: seeded })
          .where(eq(usersTable.id, user.id));
        preferredLanguage = seeded;
      }
    }

    return res.json({
      id: user.id,
      username: user.username,
      role: ctx.role,
      displayName: user.displayName,
      partnerId: ctx.partnerId,
      vendorId: ctx.vendorId,
      vendorRole: ctx.vendorRole,
      vendorPeopleId: ctx.vendorPeopleId,
      activeMembershipId: ctx.activeMembershipId,
      availableMemberships: ctx.availableMemberships,
      requiresContextChoice,
      preferredLanguage,
      // True when an admin set a temporary password — the frontend must
      // open the force-change-password modal before doing anything else.
      mustChangePassword: !!user.mustChangePassword,
      // Bearer token for native mobile clients that cannot use cookies.
      token: signed,
    });
  } catch (error) {
    logger.error({ err: error }, "Login error");
    return res.status(500).json({
      message: "Internal server error",
      code: "server.internal_error",
    });
  }
});

// Force-change-password endpoint. Always available to an authenticated
// user; intended for the modal that pops after login when the admin set
// a temp password (mustChangePassword=true). Clears the must_change
// flag and rotates session_version so the new password is required on
// subsequent device logins.
router.post("/auth/change-password", async (req, res) => {
  try {
    const session = readSession(req);
    if (!session?.userId) {
      return res.status(401).json({
        message: "Not authenticated",
        code: "auth.not_authenticated",
      });
    }
    const newPassword = String(req.body?.newPassword ?? "");
    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters",
        code: "auth.weak_password",
      });
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, session.userId as number))
      .limit(1);
    if (!user) {
      return res.status(401).json({
        message: "Not authenticated",
        code: "auth.not_authenticated",
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db
      .update(usersTable)
      .set({
        passwordHash: hash,
        mustChangePassword: false,
        sessionVersion: sql`${usersTable.sessionVersion} + 1`,
      })
      .where(eq(usersTable.id, user.id));

    // Refresh the cookie with the bumped session version so this same
    // device stays logged in (only OTHER devices get bounced).
    const refreshed = {
      ...user,
      mustChangePassword: false,
      sessionVersion: (user.sessionVersion ?? 1) + 1,
    };
    const ctx = await resolveContext(refreshed);
    const signed = buildSessionCookie(refreshed, ctx);
    res.cookie(COOKIE_NAME, signed, COOKIE_OPTIONS);
    return res.json({ ok: true, token: signed });
  } catch (error) {
    logger.error({ err: error }, "Change password error");
    return res.status(500).json({
      message: "Internal server error",
      code: "server.internal_error",
    });
  }
});

router.post("/auth/logout", async (req, res) => {
  let loginBrandQuery: string | null = null;
  const session = readSession(req);
  if (session?.userId) {
    try {
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, session.userId as number))
        .limit(1);
      if (user) {
        const ctx = await resolveContext(user);
        loginBrandQuery = loginBrandQueryFromContext(ctx);
      }
      await db
        .update(usersTable)
        .set({ sessionVersion: sql`${usersTable.sessionVersion} + 1` })
        .where(eq(usersTable.id, session.userId as number));
    } catch {
      // Non-fatal: the cookie is still cleared and the client session ends.
    }
  }
  res.clearCookie(COOKIE_NAME, { path: "/" });
  return res.json({ message: "Logged out", loginBrandQuery });
});

function readSession(req: import("express").Request): { userId: number; [k: string]: unknown } | null {
  const headerToken = (() => {
    const h = req.headers.authorization;
    if (!h) return null;
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
  })();
  const signed = req.cookies?.[COOKIE_NAME] || headerToken;
  if (!signed) return null;
  const payload = verifyPayload(signed);
  if (!payload) return null;
  try {
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    const obj = JSON.parse(decoded);
    if (!obj || typeof obj !== "object") return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof obj.exp !== "number" || obj.exp < now) return null;
    return obj;
  } catch {
    return null;
  }
}

router.get("/auth/me", async (req, res) => {
  try {
    const session = readSession(req);
    if (!session?.userId) {
      if (req.cookies?.[COOKIE_NAME]) res.clearCookie(COOKIE_NAME, { path: "/" });
      return res.status(401).json({
        message: "Not authenticated",
        code: "auth.not_authenticated",
      });
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, session.userId as number))
      .limit(1);

    if (!user) {
      res.clearCookie(COOKIE_NAME, { path: "/" });
      return res.status(401).json({
        message: "Not authenticated",
        code: "auth.not_authenticated",
      });
    }

    const ctx = await resolveContext(user);
    const requiresContextChoice =
      user.activeMembershipId === null && ctx.availableMemberships.length >= 2;

    return res.json({
      ...session,
      role: ctx.role,
      partnerId: ctx.partnerId,
      vendorId: ctx.vendorId,
      vendorRole: ctx.vendorRole,
      vendorPeopleId: ctx.vendorPeopleId,
      activeMembershipId: ctx.activeMembershipId,
      availableMemberships: ctx.availableMemberships,
      requiresContextChoice,
      preferredLanguage: normalizeLanguage(user.preferredLanguage ?? null),
      mustChangePassword: !!user.mustChangePassword,
    });
  } catch {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.status(401).json({
      message: "Invalid session",
      code: "auth.invalid_session",
    });
  }
});

router.get("/auth/memberships", async (req, res) => {
  try {
    const session = readSession(req);
    if (!session?.userId) {
      return res.status(401).json({
        message: "Not authenticated",
        code: "auth.not_authenticated",
      });
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, session.userId as number))
      .limit(1);
    if (!user) {
      return res.status(401).json({ message: "Not authenticated", code: "auth.not_authenticated" });
    }
    const ctx = await resolveContext(user);
    return res.json({
      activeMembershipId: ctx.activeMembershipId,
      memberships: ctx.availableMemberships,
    });
  } catch (error) {
    logger.error({ err: error }, "List memberships error");
    return res.status(500).json({ message: "Internal server error", code: "server.internal_error" });
  }
});

router.post("/auth/switch-context", async (req, res) => {
  try {
    const session = readSession(req);
    if (!session?.userId) {
      return res.status(401).json({
        message: "Not authenticated",
        code: "auth.not_authenticated",
      });
    }
    const membershipId = Number(req.body?.membershipId);
    if (!Number.isFinite(membershipId) || membershipId <= 0) {
      return res.status(400).json({
        message: "membershipId is required",
        code: "auth.missing_membership_id",
      });
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, session.userId as number))
      .limit(1);
    if (!user) {
      return res.status(401).json({ message: "Not authenticated", code: "auth.not_authenticated" });
    }
    const [membership] = await db
      .select()
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.id, membershipId),
          eq(userOrgMembershipsTable.userId, user.id),
        ),
      )
      .limit(1);
    if (!membership) {
      return res.status(403).json({
        message: "Membership not found for this user",
        code: "auth.invalid_membership",
      });
    }

    // Persist the user's freshly-active membership. resolveContext +
    // memberships are the single source of truth for the active
    // org/role, so we re-resolve from the DB after the update.
    await db
      .update(usersTable)
      .set({ activeMembershipId: membership.id })
      .where(eq(usersTable.id, user.id));

    const refreshedUser = { ...user, activeMembershipId: membership.id };
    const ctx = await resolveContext(refreshedUser);
    const signed = buildSessionCookie(refreshedUser, ctx);
    res.cookie(COOKIE_NAME, signed, COOKIE_OPTIONS);

    const preferredLanguage = normalizeLanguage(user.preferredLanguage);

    return res.json({
      id: user.id,
      username: user.username,
      role: ctx.role,
      displayName: user.displayName,
      partnerId: ctx.partnerId,
      vendorId: ctx.vendorId,
      vendorRole: ctx.vendorRole,
      vendorPeopleId: ctx.vendorPeopleId,
      activeMembershipId: ctx.activeMembershipId,
      availableMemberships: ctx.availableMemberships,
      // Always false right after a successful switch — the user just
      // picked a context — but include it so the response shape stays
      // consistent with /auth/login and /auth/me.
      requiresContextChoice: false,
      preferredLanguage,
      token: signed,
    });
  } catch (error) {
    logger.error({ err: error }, "Switch context error");
    return res.status(500).json({ message: "Internal server error", code: "server.internal_error" });
  }
});

router.patch("/auth/me/language", async (req, res) => {
  try {
    const session = readSession(req);
    if (!session?.userId) {
      return res.status(401).json({
        message: "Not authenticated",
        code: "auth.not_authenticated",
      });
    }
    const language = normalizeLanguage(req.body?.language);
    if (!language) {
      return res.status(400).json({
        message: "Language must be 'en', 'es', or 'pt'",
        code: "auth.invalid_language",
      });
    }
    await db
      .update(usersTable)
      .set({ preferredLanguage: language })
      .where(eq(usersTable.id, session.userId as number));
    return res.json({ preferredLanguage: language });
  } catch (error) {
    logger.error({ err: error }, "Update preferred language error");
    return res.status(500).json({
      message: "Internal server error",
      code: "server.internal_error",
    });
  }
});

if (process.env.NODE_ENV === "development") {
  // Demo-account discovery endpoint (`GET /auth/demo-users`) intentionally
  // removed — VNDRLY does real-world testing with named human accounts
  // only. Do not reintroduce.

  router.post("/auth/seed", async (_req, res) => {
    try {
      const hash = (pw: string) => bcrypt.hashSync(pw, 10);

      const existing = await db
        .select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable);
      const existingByName = new Map(
        existing.map((u) => [u.username.toLowerCase(), u.id] as const),
      );

      const inserted: { id: number; demo: typeof DEMO_USERS[number] }[] = [];
      const passwordReset: string[] = [];

      // Sync each demo user (and its memberships) atomically. New users
      // are inserted alongside their membership rows in a single
      // transaction so a fresh DB never has a "user without membership"
      // window. Existing users have any missing memberships filled in
      // idempotently AND their password is re-hashed back to the
      // canonical demo password whenever the stored hash has drifted
      // (e.g. a SQL import from another environment left a stale hash
      // behind). Without this, demo logins silently 401 and the only
      // recovery is hand-editing bcrypt hashes — see Task #739.
      for (const demo of DEMO_USERS) {
        // Build the canonical membership list for this demo. If the
        // demo declares memberships explicitly we use them; otherwise
        // derive a single one from the demo's `partnerId`/`vendorId`
        // metadata. Admins (no partner, no vendor) get no membership
        // row. Field-employee demos must keep the field_employee
        // in-org role so resolveContext lights up the field portal.
        const derivedRole: "admin" | "field_employee" =
          demo.role === "field_employee" ? "field_employee" : "admin";
        const desired =
          demo.memberships && demo.memberships.length > 0
            ? demo.memberships
            : demo.partnerId
              ? [{ orgType: "partner" as const, orgId: demo.partnerId, role: derivedRole }]
              : demo.vendorId
                ? [{ orgType: "vendor" as const, orgId: demo.vendorId, role: derivedRole }]
                : [];

        await db.transaction(async (tx) => {
          let userId = existingByName.get(demo.username.toLowerCase()) ?? null;
          let userActiveMembershipId: number | null = null;

          if (userId === null) {
            const [newRow] = await tx
              .insert(usersTable)
              .values({
                username: demo.username,
                passwordHash: hash(demo.password),
                role: demo.role,
                displayName: demo.displayName,
                preferredLanguage: normalizeLanguage(demo.preferredLanguage ?? null),
              })
              .returning({ id: usersTable.id });
            userId = newRow.id;
            inserted.push({ id: userId, demo });
          } else {
            const [u] = await tx
              .select({
                activeMembershipId: usersTable.activeMembershipId,
                passwordHash: usersTable.passwordHash,
                mustChangePassword: usersTable.mustChangePassword,
              })
              .from(usersTable)
              .where(eq(usersTable.id, userId));
            userActiveMembershipId = u?.activeMembershipId ?? null;

            // Idempotent password recovery: if the stored hash no longer
            // verifies against the canonical demo password (drifted from
            // a stale import, a manual edit, or a /change-password call),
            // re-hash it back to demo and clear mustChangePassword.
            //
            // We deliberately do NOT bump session_version here. This is
            // a dev-only seed that runs idempotently (and is auto-invoked
            // by the demo-login picker on every page load), so any
            // transient hash drift would otherwise cascade into invalidating
            // every active demo session — including the agent / browser
            // session that triggered the seed. Per-user TXs commit
            // independently, so a partial-failure response could leave
            // sv bumped on accounts that succeeded earlier in the loop,
            // which is exactly the footgun that broke the @vndrly.com
            // accounts in May 2026. The restored password alone is enough
            // for a clean next login; existing sessions carry userId + sv,
            // not the password, so they keep working.
            const passwordOk =
              !!u && bcrypt.compareSync(demo.password, u.passwordHash);
            if (!passwordOk) {
              await tx
                .update(usersTable)
                .set({
                  passwordHash: hash(demo.password),
                  mustChangePassword: false,
                })
                .where(eq(usersTable.id, userId));
              passwordReset.push(demo.username);
              logger.warn(
                { username: demo.username, userId },
                "auth/seed: restored drifted demo password (existing sessions preserved)",
              );
            } else if (u?.mustChangePassword) {
              // Hash already matches but the must-change flag is still
              // set from a prior admin reset. Clear it so the demo user
              // is not stuck in the force-change modal.
              await tx
                .update(usersTable)
                .set({ mustChangePassword: false })
                .where(eq(usersTable.id, userId));
            }
          }

          const existingMemberships = await tx
            .select()
            .from(userOrgMembershipsTable)
            .where(eq(userOrgMembershipsTable.userId, userId));

          for (const m of desired) {
            const already = existingMemberships.find((row) =>
              m.orgType === "partner" ? row.partnerId === m.orgId : row.vendorId === m.orgId,
            );
            if (already) continue;
            await tx.insert(userOrgMembershipsTable).values({
              userId,
              orgType: m.orgType,
              partnerId: m.orgType === "partner" ? m.orgId : null,
              vendorId: m.orgType === "vendor" ? m.orgId : null,
              role: m.role,
            });
          }

          // For users with multiple memberships, leave activeMembershipId
          // null so the post-login picker is shown the first time they
          // log in. Single-membership users get activeMembershipId set
          // to that membership so the switcher is hidden by default.
          const allMyMemberships = await tx
            .select()
            .from(userOrgMembershipsTable)
            .where(eq(userOrgMembershipsTable.userId, userId));
          if (
            allMyMemberships.length === 1 &&
            userActiveMembershipId !== allMyMemberships[0].id
          ) {
            await tx
              .update(usersTable)
              .set({ activeMembershipId: allMyMemberships[0].id })
              .where(eq(usersTable.id, userId));
          }
        });
      }

      return res.json({
        message: existing.length === 0 ? "Seed users created" : "Synced demo users + memberships",
        added: inserted.map((i) => i.demo.username),
        // Surfaces which existing users had their bcrypt hash refreshed
        // back to the canonical demo password during this call. Empty
        // when nothing drifted.
        passwordReset,
      });
    } catch (error) {
      logger.error({ err: error }, "Seed error");
      return res.status(500).json({ message: "Failed to seed users", code: "auth.seed_failed" });
    }
  });

  // Dev-only: deterministic fixture for the bulk 1099-recategorize end-to-
  // end tests. Idempotent — repeated calls return the same IDs without
  // duplicating rows. Provides:
  //   - A vendor ("1099 Fixture Vendor") with a federal_tax_id so it can
  //     surface on the admin 1099 dashboard.
  //   - A draft invoice for that vendor with three lines of mixed line
  //     types so the multi-select toolbar has rows to operate on.
  //   - A paid invoice in the current calendar year with an NEC line over
  //     the $600 threshold so the vendor appears in the dashboard, giving
  //     the per-vendor "Recategorize draft lines" dropdown something to
  //     act on.
  // Uses partner id 1 (ExxonMobil) which is created by the standard demo
  // seed. Returns the IDs the test plan needs to deep-link into the
  // invoice detail page and assert against the dashboard row.
  router.post("/auth/seed-1099-fixture", async (_req, res) => {
    try {
      // 0. Make sure the demo accounts exist (admin login is required by
      // both tests). Mirror the inline upsert from /auth/seed for the
      // admin user only, so calling this endpoint on a fresh database
      // works without needing /auth/seed first.
      const ADMIN = DEMO_USERS.find((u) => u.username === "admin");
      if (ADMIN) {
        const [existingAdmin] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(sql`lower(${usersTable.username}) = lower(${ADMIN.username})`);
        if (!existingAdmin) {
          await db.insert(usersTable).values({
            username: ADMIN.username,
            passwordHash: bcrypt.hashSync(ADMIN.password, 10),
            role: ADMIN.role,
            displayName: ADMIN.displayName,
          });
        }
      }

      // 1. Partner — reuse seeded partner id 1 (ExxonMobil) if present,
      // otherwise create a fixture partner. Stored federal_tax_id so the
      // 1099 dashboard has a payer name to render.
      let partnerId: number;
      const [seededPartner] = await db
        .select({ id: partnersTable.id })
        .from(partnersTable)
        .where(eq(partnersTable.id, 1));
      if (seededPartner) {
        partnerId = seededPartner.id;
      } else {
        const [p] = await db
          .insert(partnersTable)
          .values({
            name: "Fixture Partner",
            contactName: "Fixture Partner Contact",
            contactEmail: "fixture-partner@example.com",
            federalTaxId: "12-3456789",
            billingAddress: "123 Fixture Way, Houston, TX 77001",
          })
          .returning({ id: partnersTable.id });
        partnerId = p.id;
      }

      // 2. Vendor — deterministic name. Idempotent insert by name.
      const VENDOR_NAME = "1099 Fixture Vendor";
      let vendorRow = (
        await db
          .select({ id: vendorsTable.id })
          .from(vendorsTable)
          .where(eq(vendorsTable.name, VENDOR_NAME))
      )[0];
      if (!vendorRow) {
        const [v] = await db
          .insert(vendorsTable)
          .values({
            name: VENDOR_NAME,
            contactName: "Fixture Vendor Contact",
            contactEmail: "fixture-vendor@example.com",
            federalTaxId: "98-7654321",
            billingAddress: "999 Fixture Rd, Midland, TX 79701",
          })
          .returning({ id: vendorsTable.id });
        vendorRow = v;
      }
      const vendorId = vendorRow.id;

      // 3. Draft invoice + 3 lines (current month, fixture-1099-draft
      // invoice number is unique so re-runs are idempotent).
      const now = new Date();
      const year = now.getUTCFullYear();
      const monthStart = new Date(Date.UTC(year, now.getUTCMonth(), 1));
      const monthEnd = new Date(
        Date.UTC(year, now.getUTCMonth() + 1, 0, 23, 59, 59),
      );
      const DRAFT_INVOICE_NUMBER = `FIXTURE-1099-DRAFT-${vendorId}`;
      let draftInvoiceRow = (
        await db
          .select({ id: invoicesTable.id })
          .from(invoicesTable)
          .where(eq(invoicesTable.invoiceNumber, DRAFT_INVOICE_NUMBER))
      )[0];
      if (!draftInvoiceRow) {
        const [i] = await db
          .insert(invoicesTable)
          .values({
            invoiceNumber: DRAFT_INVOICE_NUMBER,
            vendorId,
            partnerId,
            cadence: "monthly",
            status: "draft",
            periodStart: monthStart,
            periodEnd: monthEnd,
            subtotal: "1500.00",
            taxTotal: "0.00",
            total: "1500.00",
          })
          .returning({ id: invoicesTable.id });
        draftInvoiceRow = i;
      }
      const draftInvoiceId = draftInvoiceRow.id;

      // Idempotency: if a prior run (or an unrelated lifecycle event)
      // promoted the fixture invoice past `draft`, force it back so the
      // inline-edit / bulk-recategorize flows under test stay enabled
      // (canEditInvoice gates on status === 'draft').
      await db
        .update(invoicesTable)
        .set({ status: "draft" })
        .where(eq(invoicesTable.id, draftInvoiceId));

      // Reset the draft invoice lines to a known baseline on every call.
      // The bulk-recategorize tests mutate incomeCategory and the manual
      // override flag, so unconditionally deleting + re-inserting keeps
      // the fixture deterministic across re-runs even if a prior run left
      // partial state behind.
      await db
        .delete(invoiceLinesTable)
        .where(eq(invoiceLinesTable.invoiceId, draftInvoiceId));
      const insertedDraftLines = await db
        .insert(invoiceLinesTable)
        .values([
          {
            invoiceId: draftInvoiceId,
            sourceType: "manual",
            lineType: "labor_regular",
            description: "Fixture labor — site supervisor",
            quantity: "10",
            unitPrice: "75.00",
            amount: "750.00",
            taxAmount: "0.00",
            incomeCategory: "nec",
          },
          {
            invoiceId: draftInvoiceId,
            sourceType: "manual",
            lineType: "equipment",
            description: "Fixture equipment — pump rental",
            quantity: "1",
            unitPrice: "500.00",
            amount: "500.00",
            taxAmount: "0.00",
            incomeCategory: "nec",
          },
          {
            invoiceId: draftInvoiceId,
            sourceType: "manual",
            lineType: "mileage",
            description: "Fixture mileage — round trip",
            quantity: "100",
            unitPrice: "2.50",
            amount: "250.00",
            taxAmount: "0.00",
            incomeCategory: "nec",
          },
        ])
        .returning({ id: invoiceLinesTable.id });
      const draftLineIds: number[] = insertedDraftLines.map((l) => l.id);

      // 4. Paid invoice + payment in the current calendar year so the
      // vendor surfaces on the 1099 dashboard for `year`. NEC line is well
      // above the $600 threshold (totalPaid filter in nec1099Rows).
      const PAID_INVOICE_NUMBER = `FIXTURE-1099-PAID-${vendorId}-${year}`;
      let paidInvoiceRow = (
        await db
          .select({ id: invoicesTable.id, total: invoicesTable.total })
          .from(invoicesTable)
          .where(eq(invoicesTable.invoiceNumber, PAID_INVOICE_NUMBER))
      )[0];
      if (!paidInvoiceRow) {
        // Use Feb of the current year so we never collide with the draft
        // invoice's (vendor, partner, cadence, periodStart) uniqueness
        // guard regardless of when the fixture is invoked.
        const paidPeriodStart = new Date(Date.UTC(year, 1, 1));
        const paidPeriodEnd = new Date(Date.UTC(year, 1, 28, 23, 59, 59));
        const [pi] = await db
          .insert(invoicesTable)
          .values({
            invoiceNumber: PAID_INVOICE_NUMBER,
            vendorId,
            partnerId,
            cadence: "monthly",
            status: "paid",
            periodStart: paidPeriodStart,
            periodEnd: paidPeriodEnd,
            subtotal: "1200.00",
            taxTotal: "0.00",
            total: "1200.00",
            paidAmount: "1200.00",
            paidAt: new Date(Date.UTC(year, 1, 15)),
            sentAt: new Date(Date.UTC(year, 1, 5)),
          })
          .returning({ id: invoicesTable.id, total: invoicesTable.total });
        paidInvoiceRow = pi;
        await db.insert(invoiceLinesTable).values({
          invoiceId: pi.id,
          sourceType: "manual",
          lineType: "labor_regular",
          description: "Fixture paid labor — January work",
          quantity: "16",
          unitPrice: "75.00",
          amount: "1200.00",
          taxAmount: "0.00",
          incomeCategory: "nec",
        });
        await db.insert(invoicePaymentsTable).values({
          invoiceId: pi.id,
          method: "ach",
          amount: "1200.00",
          paidAt: new Date(Date.UTC(year, 1, 15)),
        });
      }
      const paidInvoiceId = paidInvoiceRow.id;

      return res.json({
        ok: true,
        vendorId,
        vendorName: VENDOR_NAME,
        partnerId,
        draftInvoiceId,
        draftInvoiceNumber: DRAFT_INVOICE_NUMBER,
        draftLineIds,
        paidInvoiceId,
        year,
      });
    } catch (error) {
      logger.error({ err: error }, "1099 fixture seed error");
      return res
        .status(500)
        .json({ message: "Failed to seed 1099 fixture", code: "auth.fixture_seed_failed", error: String(error) });
    }
  });

  // Dev-only: deterministic fixture for the audit-log pagination end-to-end
  // test (lib/e2e/tests/audit-log-pagination.spec.ts). Truncates the
  // report_export_audit_log table and re-inserts a known mix of rows so
  // the spec can:
  //   - Page from page 1 → page 2 → back, against a known row count.
  //   - Toggle "with warnings only" and assert the visible row count
  //     drops to a known value.
  //   - Click a "Retry of #N" badge whose target sits on page 2 and
  //     assert the page jumps and the badged row scrolls into view.
  //
  // Layout (page size = 100, ordered desc by createdAt):
  //   - 1 chain TIP at the very newest timestamp on page 1, with
  //     scope.retriedFromAuditId = root id. Its "Retry of #N" badge
  //     resolves to the root row that lives on page 2.
  //   - 3 rows on page 1 carrying detailJson.warnings so the warnings
  //     filter has something to filter to.
  //   - 96 plain filler rows on page 1.
  //   - 49 plain filler rows on page 2.
  //   - 1 chain ROOT at the very oldest timestamp at the bottom of
  //     page 2.
  // Total: 150 rows, exactly 2 pages.
  router.post("/auth/seed-audit-pagination-fixture", async (_req, res) => {
    try {
      // Wipe any prior audit rows so the spec runs against an exact row
      // count regardless of what the dev DB looked like before. This
      // table is purely an after-the-fact log — no other table holds a
      // foreign key into it — so a TRUNCATE is safe in dev.
      await db.execute(sql`TRUNCATE TABLE report_export_audit_log RESTART IDENTITY`);

      // Build createdAt timestamps from oldest → newest so the desc(
      // createdAt) sort the route uses places the newest entries on
      // page 1. Spread one second between each so ties don't form.
      const TOTAL = 150;
      const PAGE_SIZE = 100;
      const baseEpoch = Date.UTC(2026, 0, 1, 0, 0, 0);
      const ts = (i: number): Date => new Date(baseEpoch + i * 1000);

      // 1. Insert the chain ROOT at the OLDEST timestamp (i = 0). It
      //    will land at the very bottom of page 2.
      const [rootRow] = await db
        .insert(reportExportAuditLogTable)
        .values({
          reportKind: "qb_invoice_push",
          format: "qbo_api_push",
          scope: { period: "audit-fixture-root" },
          detailJson: null,
          rowCount: 1,
          fileBytes: 0,
          downloadedByUserId: null,
          userRole: "admin",
          userIp: null,
          userAgent: null,
          createdAt: ts(0),
        })
        .returning({ id: reportExportAuditLogTable.id });
      const rootId = rootRow.id;

      // 2. Insert 148 plain filler rows in between (i = 1 .. 148). 49 of
      //    these will be on page 2 (with the root) and the other 99 on
      //    page 1 (with the chain tip and the warning rows).
      const fillerCount = TOTAL - 2;
      const fillerValues = [] as Array<typeof reportExportAuditLogTable.$inferInsert>;
      for (let i = 1; i <= fillerCount; i++) {
        fillerValues.push({
          reportKind: "qb_invoice_push",
          format: "qbo_api_push",
          scope: { period: "audit-fixture-filler", n: i },
          detailJson: null,
          rowCount: 1,
          fileBytes: 0,
          downloadedByUserId: null,
          userRole: "admin",
          userIp: null,
          userAgent: null,
          createdAt: ts(i),
        });
      }
      const insertedFillers = await db
        .insert(reportExportAuditLogTable)
        .values(fillerValues)
        .returning({ id: reportExportAuditLogTable.id });

      // 3. Pick three of the most recent fillers (those that landed at
      //    the highest i values) and stamp them with detailJson.warnings
      //    so the warnings filter narrows the visible page from 100 → 3.
      //    These rows live on page 1 with the chain tip.
      const warningTargets = insertedFillers.slice(-3);
      const warningIds: number[] = [];
      for (const row of warningTargets) {
        await db
          .update(reportExportAuditLogTable)
          .set({
            detailJson: {
              warnings: [
                {
                  kind: "audit_fixture",
                  identifier: "FIXTURE-WARN",
                  message: "seeded warning",
                },
              ],
            },
          })
          .where(eq(reportExportAuditLogTable.id, row.id));
        warningIds.push(row.id);
      }

      // 4. Insert the chain TIP at the NEWEST timestamp so it lands at
      //    the very top of page 1. Its "Retry of #<rootId>" badge points
      //    at the root row on page 2.
      const [tipRow] = await db
        .insert(reportExportAuditLogTable)
        .values({
          reportKind: "qb_invoice_push",
          format: "qbo_api_push",
          scope: {
            period: "audit-fixture-tip",
            retriedFromAuditId: rootId,
          },
          detailJson: null,
          rowCount: 1,
          fileBytes: 0,
          downloadedByUserId: null,
          userRole: "admin",
          userIp: null,
          userAgent: null,
          createdAt: ts(TOTAL - 1),
        })
        .returning({ id: reportExportAuditLogTable.id });
      const tipId = tipRow.id;

      return res.json({
        ok: true,
        totalRows: TOTAL,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil(TOTAL / PAGE_SIZE),
        rootId,
        tipId,
        warningIds,
        warningCount: warningIds.length,
      });
    } catch (error) {
      logger.error({ err: error }, "audit pagination fixture seed error");
      return res.status(500).json({
        message: "Failed to seed audit-pagination fixture",
        code: "auth.fixture_seed_failed",
        error: String(error),
      });
    }
  });
}

export default router;
