// Admin endpoints for attaching / removing user logins to a Partner or
// Vendor organization. Backed by `user_org_memberships` so the same
// login can belong to multiple orgs and use the in-app context picker.

import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  partnersTable,
  userOrgMembershipsTable,
  usersTable,
  vendorPeopleTable,
  vendorsTable,
} from "@workspace/db";
import {
  removeMembership,
  type MembershipRole,
  type OrgType,
} from "../lib/membership-sync";
import { logger } from "../lib/logger";
import { SESSION_SECRET } from "../lib/session";

const router = Router();

const COOKIE_NAME = "vndrly_session";

interface Session {
  userId: number;
  role: string;
  partnerId: number | null;
  vendorId: number | null;
}

function readSession(req: import("express").Request): Session | null {
  const headerToken = (() => {
    const h = req.headers.authorization;
    if (!h) return null;
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
  })();
  const signed = req.cookies?.[COOKIE_NAME] || headerToken;
  if (!signed) return null;
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(sig, "hex"),
        Buffer.from(expected, "hex"),
      )
    )
      return null;
  } catch {
    return null;
  }
  try {
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    const obj = JSON.parse(decoded);
    const now = Math.floor(Date.now() / 1000);
    if (!obj || typeof obj.exp !== "number" || obj.exp < now) return null;
    return obj;
  } catch {
    return null;
  }
}

function parseOrgType(raw: string): OrgType | null {
  if (raw === "partner" || raw === "vendor") return raw;
  return null;
}

function parseMemberRole(
  raw: unknown,
  orgType: OrgType,
): "admin" | "member" | "ap" | null {
  if (raw === "admin" || raw === "member") return raw;
  // AP is partner-only: vendor orgs have no Accounts Payable concept.
  if (raw === "ap" && orgType === "partner") return raw;
  return null;
}

/**
 * Authorization for these endpoints: a `system admin` (legacy
 * `users.role = 'admin'`) can manage any org; an org admin (a user
 * whose active session is in this org with role admin) can manage
 * memberships for their own org. Field-employee memberships are
 * intentionally not exposed here — they live behind the
 * `/field-employees/:id/login` flow which already syncs memberships.
 */
async function requireOrgAdmin(
  req: import("express").Request,
  orgType: OrgType,
  orgId: number,
): Promise<{ session: Session; isSystemAdmin: boolean } | { error: { status: number; body: { message: string; code: string } } }> {
  const session = readSession(req);
  if (!session?.userId) {
    return {
      error: {
        status: 401,
        body: {
          message: "Not authenticated",
          code: "auth.not_authenticated",
        },
      },
    };
  }
  if (session.role === "admin") {
    return { session, isSystemAdmin: true };
  }
  // Must be an admin of THIS org.
  const [active] = await db
    .select({
      id: userOrgMembershipsTable.id,
      orgType: userOrgMembershipsTable.orgType,
      partnerId: userOrgMembershipsTable.partnerId,
      vendorId: userOrgMembershipsTable.vendorId,
      role: userOrgMembershipsTable.role,
    })
    .from(userOrgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, userOrgMembershipsTable.userId))
    .where(
      and(
        eq(userOrgMembershipsTable.userId, session.userId),
        eq(userOrgMembershipsTable.orgType, orgType),
        orgType === "partner"
          ? eq(userOrgMembershipsTable.partnerId, orgId)
          : eq(userOrgMembershipsTable.vendorId, orgId),
      ),
    )
    .limit(1);
  if (active && active.role === "admin") {
    return { session, isSystemAdmin: false };
  }
  return {
    error: {
      status: 403,
      body: {
        message: "Admin access required for this organization",
        code: "auth.forbidden",
      },
    },
  };
}

router.get(
  "/orgs/:orgType/:orgId/members",
  async (req, res): Promise<void> => {
    const orgType = parseOrgType(req.params.orgType);
    const orgId = Number(req.params.orgId);
    if (!orgType || !Number.isFinite(orgId)) {
      res.status(400).json({
        message: "Invalid orgType or orgId",
        code: "members.invalid_org",
      });
      return;
    }
    const auth = await requireOrgAdmin(req, orgType, orgId);
    if ("error" in auth) {
      res.status(auth.error.status).json(auth.error.body);
      return;
    }
    // For vendor orgs we LEFT JOIN `vendor_people` (the field-
    // employee table) on `user_id = users.id AND vendor_id = orgId`
    // so admin / member rows that happen to also be a field-employee
    // on the same vendor expose their `phone` and `pec_expiration_date`
    // alongside the membership. Scoping the join to the same vendor
    // keeps cross-vendor field-employee data from leaking into a
    // different vendor's admin team table.
    //
    // For partner orgs we still emit the columns but they are always
    // null — partners have no field-employee records and the join
    // would never match.
    const rows = await db
      .select({
        membershipId: userOrgMembershipsTable.id,
        membershipRole: userOrgMembershipsTable.role,
        userId: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        legacyRole: usersTable.role,
        phone: vendorPeopleTable.phone,
        pecExpirationDate: vendorPeopleTable.pecExpirationDate,
        // Task #1156 follow-on: surface jobTitle + photoUrl so the
        // Administrative Team Members card can mirror the Field
        // Employees card (Job Title column + photo/UserCheck icon
        // beside the name). Same vendor-scoped LEFT JOIN as phone
        // and PEC — partner-org rows always read null.
        jobTitle: vendorPeopleTable.jobTitle,
        photoUrl: vendorPeopleTable.photoUrl,
      })
      .from(userOrgMembershipsTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, userOrgMembershipsTable.userId),
      )
      .leftJoin(
        vendorPeopleTable,
        orgType === "vendor"
          ? and(
              eq(vendorPeopleTable.userId, usersTable.id),
              eq(vendorPeopleTable.vendorId, orgId),
            )
          : sql`false`,
      )
      .where(
        and(
          eq(userOrgMembershipsTable.orgType, orgType),
          orgType === "partner"
            ? eq(userOrgMembershipsTable.partnerId, orgId)
            : eq(userOrgMembershipsTable.vendorId, orgId),
        ),
      )
      .orderBy(asc(userOrgMembershipsTable.id));
    res.json({
      orgType,
      orgId,
      members: rows.map((r) => ({
        membershipId: r.membershipId,
        userId: r.userId,
        username: r.username,
        displayName: r.displayName,
        role: r.membershipRole,
        legacyRole: r.legacyRole,
        phone: r.phone ?? null,
        pecExpirationDate: r.pecExpirationDate ?? null,
        jobTitle: r.jobTitle ?? null,
        photoUrl: r.photoUrl ?? null,
      })),
    });
  },
);

router.post(
  "/orgs/:orgType/:orgId/members",
  async (req, res): Promise<void> => {
    const orgType = parseOrgType(req.params.orgType);
    const orgId = Number(req.params.orgId);
    if (!orgType || !Number.isFinite(orgId)) {
      res.status(400).json({
        message: "Invalid orgType or orgId",
        code: "members.invalid_org",
      });
      return;
    }
    const auth = await requireOrgAdmin(req, orgType, orgId);
    if ("error" in auth) {
      res.status(auth.error.status).json(auth.error.body);
      return;
    }

    const emailRaw = req.body?.email;
    const email = typeof emailRaw === "string" ? emailRaw.trim() : "";
    if (!email) {
      res.status(400).json({
        message: "email is required",
        code: "members.missing_email",
      });
      return;
    }
    const role = parseMemberRole(req.body?.role, orgType) ?? "member";
    const passwordRaw = req.body?.password;
    const password = typeof passwordRaw === "string" ? passwordRaw : "";
    const displayNameRaw = req.body?.displayName;
    const displayName =
      typeof displayNameRaw === "string" && displayNameRaw.trim().length > 0
        ? displayNameRaw.trim()
        : null;

    // Confirm the org actually exists so we don't create orphan memberships.
    if (orgType === "partner") {
      const [p] = await db
        .select({ id: partnersTable.id })
        .from(partnersTable)
        .where(eq(partnersTable.id, orgId))
        .limit(1);
      if (!p) {
        res.status(404).json({
          message: "Partner not found",
          code: "members.org_not_found",
        });
        return;
      }
    } else {
      const [v] = await db
        .select({ id: vendorsTable.id })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, orgId))
        .limit(1);
      if (!v) {
        res.status(404).json({
          message: "Vendor not found",
          code: "members.org_not_found",
        });
        return;
      }
    }

    try {
      // Atomic: create user (if needed) + add membership in the same
      // transaction so we never leave behind an orphaned user account
      // if membership insertion fails. Existing users have credentials
      // / displayName left untouched — this endpoint only attaches
      // memberships, never reaches into other accounts.
      const result = await db.transaction(async (tx) => {
        const [existingUser] = await tx
          .select()
          .from(usersTable)
          .where(sql`lower(${usersTable.username}) = lower(${email})`)
          .limit(1);

        let userId: number;
        let createdUser = false;
        if (existingUser) {
          if (existingUser.role === "field_employee") {
            throw Object.assign(
              new Error(
                "That login belongs to a field employee. Use the field employee tools instead.",
              ),
              { http: 409, code: "members.is_field_employee" },
            );
          }
          // SECURITY: Do NOT mutate an existing user's password or
          // displayName here — an org admin must not be able to reset
          // credentials for any login they happen to know the email
          // of. Caller-supplied password / displayName are silently
          // ignored when the user already exists.
          userId = existingUser.id;
        } else {
          if (!password || password.length < 8) {
            throw Object.assign(
              new Error("Password must be at least 8 characters"),
              { http: 400, code: "members.weak_password" },
            );
          }
          const passwordHash = bcrypt.hashSync(password, 10);
          // `user_org_memberships` (inserted just below) is the single
          // source of truth for which org a user belongs to.
          const sessionRole = orgType === "partner" ? "partner" : "vendor";
          const [created] = await tx
            .insert(usersTable)
            .values({
              username: email,
              // `email` is the canonical contact email and the join key
              // used by visitor-check-in notifications
              // (`findPartnerVisitNotifierUserIds`). It mirrors
              // `username` here because org-member onboarding uses the
              // email as the login.
              email,
              passwordHash,
              role: sessionRole,
              displayName: displayName ?? email,
            })
            .returning();
          userId = created.id;
          createdUser = true;
        }

        // Inline membership insert (idempotent) inside the same tx so
        // user creation + membership attach succeed or fail together.
        const [insertedMembership] = await tx
          .insert(userOrgMembershipsTable)
          .values({
            userId,
            orgType,
            partnerId: orgType === "partner" ? orgId : null,
            vendorId: orgType === "vendor" ? orgId : null,
            role: role as MembershipRole,
            vendorPeopleId: null,
          })
          .onConflictDoNothing()
          .returning({ id: userOrgMembershipsTable.id });

        let membershipId: number;
        if (insertedMembership) {
          membershipId = insertedMembership.id;
        } else {
          const [existingMembership] = await tx
            .select({
              id: userOrgMembershipsTable.id,
              role: userOrgMembershipsTable.role,
            })
            .from(userOrgMembershipsTable)
            .where(
              and(
                eq(userOrgMembershipsTable.userId, userId),
                orgType === "partner"
                  ? eq(userOrgMembershipsTable.partnerId, orgId)
                  : eq(userOrgMembershipsTable.vendorId, orgId),
              ),
            )
            .limit(1);
          if (!existingMembership) {
            throw new Error("Failed to add or find membership");
          }
          membershipId = existingMembership.id;
          if (existingMembership.role !== role) {
            await tx
              .update(userOrgMembershipsTable)
              .set({ role: role as MembershipRole })
              .where(eq(userOrgMembershipsTable.id, membershipId));
            // Increment sessionVersion so any existing tokens for this user
            // become invalid immediately; the new role is reflected on
            // their next login rather than after token expiry.
            await tx
              .update(usersTable)
              .set({ sessionVersion: sql`${usersTable.sessionVersion} + 1` })
              .where(eq(usersTable.id, userId));
          }
        }

        // For brand-new users, point activeMembershipId at this freshly
        // created membership so resolveContext picks it up before they
        // first log in. Pre-existing users keep whatever active context
        // they already had.
        if (createdUser) {
          await tx
            .update(usersTable)
            .set({ activeMembershipId: membershipId })
            .where(eq(usersTable.id, userId));
        }

        return { userId, membershipId, createdUser };
      });

      res.status(result.createdUser ? 201 : 200).json({
        membershipId: result.membershipId,
        userId: result.userId,
        username: email,
        role,
        createdUser: result.createdUser,
      });
    } catch (err: unknown) {
      const e = err as { http?: number; message?: string; code?: string };
      logger.error({ err }, "Add member error");
      // Only forward `code` values that we deliberately set in this
      // route (the `members.*` namespace). Anything else — e.g. a raw
      // Postgres error code bubbling up from the driver — is collapsed
      // back to the generic `members.add_failed` so the client never
      // sees an unstable, low-level identifier it has no branch for.
      const code =
        typeof e.code === "string" && e.code.startsWith("members.")
          ? e.code
          : "members.add_failed";
      res.status(e.http || 500).json({
        message: e.message || "Failed to add member",
        code,
      });
    }
  },
);

// PATCH membership role. Lets an org admin upgrade an existing teammate
// to AP (Accounts Payable) — or back down to plain member — without
// having to delete and recreate the login. Field-employee memberships
// stay locked to the field-employee tools (they own their own sync).
router.patch(
  "/orgs/:orgType/:orgId/members/:membershipId",
  async (req, res): Promise<void> => {
    const orgType = parseOrgType(req.params.orgType);
    const orgId = Number(req.params.orgId);
    const membershipId = Number(req.params.membershipId);
    if (!orgType || !Number.isFinite(orgId)) {
      res.status(400).json({
        message: "Invalid org",
        code: "members.invalid_org",
      });
      return;
    }
    if (!Number.isFinite(membershipId)) {
      res.status(400).json({
        message: "Invalid params",
        code: "members.invalid_params",
      });
      return;
    }
    const auth = await requireOrgAdmin(req, orgType, orgId);
    if ("error" in auth) {
      res.status(auth.error.status).json(auth.error.body);
      return;
    }
    const newRole = parseMemberRole(req.body?.role, orgType);
    if (!newRole) {
      res.status(400).json({
        message:
          orgType === "partner"
            ? "role must be one of: admin, member, ap"
            : "role must be one of: admin, member",
        code: "members.invalid_role",
      });
      return;
    }
    // Confirm the membership belongs to this org so an admin can't
    // change cross-org rows by guessing membership ids.
    const [m] = await db
      .select()
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.id, membershipId),
          eq(userOrgMembershipsTable.orgType, orgType),
          orgType === "partner"
            ? eq(userOrgMembershipsTable.partnerId, orgId)
            : eq(userOrgMembershipsTable.vendorId, orgId),
        ),
      )
      .limit(1);
    if (!m) {
      res.status(404).json({
        message: "Membership not found",
        code: "members.not_found",
      });
      return;
    }
    if (m.role === "field_employee") {
      res.status(400).json({
        message:
          "Field-employee memberships are managed via the field employee tools",
        code: "members.field_only",
      });
      return;
    }
    // Don't let the only admin demote themselves and lock the org out.
    if (
      m.role === "admin" &&
      newRole !== "admin" &&
      auth.session.userId === m.userId &&
      !auth.isSystemAdmin
    ) {
      res.status(400).json({
        message: "You can't demote your own admin membership",
        code: "members.cant_demote_self",
      });
      return;
    }
    if (m.role === newRole) {
      // No-op short-circuit — return the row as-is so the client can
      // patch UI optimistically without round-tripping to a 304.
      res.json({
        membershipId: m.id,
        userId: m.userId,
        role: m.role,
      });
      return;
    }
    // Atomic role swap + sessionVersion bump. The bump invalidates any
    // session tokens this user already holds so the new role takes
    // effect on their next request instead of waiting for the existing
    // token to expire (mirrors the POST handler's behavior when it
    // mutates an existing membership's role).
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(userOrgMembershipsTable)
        .set({ role: newRole })
        .where(eq(userOrgMembershipsTable.id, membershipId))
        .returning();
      if (!row) return null;
      await tx
        .update(usersTable)
        .set({ sessionVersion: sql`${usersTable.sessionVersion} + 1` })
        .where(eq(usersTable.id, row.userId));
      return row;
    });
    if (!updated) {
      res.status(404).json({
        message: "Membership not found",
        code: "members.not_found",
      });
      return;
    }
    res.json({
      membershipId: updated.id,
      userId: updated.userId,
      role: updated.role as MembershipRole,
    });
  },
);

router.delete(
  "/orgs/:orgType/:orgId/members/:membershipId",
  async (req, res): Promise<void> => {
    const orgType = parseOrgType(req.params.orgType);
    const orgId = Number(req.params.orgId);
    const membershipId = Number(req.params.membershipId);
    if (!orgType || !Number.isFinite(orgId)) {
      res.status(400).json({
        message: "Invalid org",
        code: "members.invalid_org",
      });
      return;
    }
    if (!Number.isFinite(membershipId)) {
      res.status(400).json({
        message: "Invalid params",
        code: "members.invalid_params",
      });
      return;
    }
    const auth = await requireOrgAdmin(req, orgType, orgId);
    if ("error" in auth) {
      res.status(auth.error.status).json(auth.error.body);
      return;
    }
    // Confirm the membership belongs to this org so an admin can't
    // delete cross-org rows by guessing membership ids.
    const [m] = await db
      .select()
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.id, membershipId),
          eq(userOrgMembershipsTable.orgType, orgType),
          orgType === "partner"
            ? eq(userOrgMembershipsTable.partnerId, orgId)
            : eq(userOrgMembershipsTable.vendorId, orgId),
        ),
      )
      .limit(1);
    if (!m) {
      res.status(404).json({
        message: "Membership not found",
        code: "members.not_found",
      });
      return;
    }
    if (m.role === "field_employee") {
      res.status(400).json({
        message: "Field-employee memberships are managed via the field employee tools",
        code: "members.field_only",
      });
      return;
    }

    // Don't let an org admin delete their own active membership and
    // lock themselves out.
    if (
      auth.session.userId === m.userId &&
      !auth.isSystemAdmin
    ) {
      res.status(400).json({
        message: "You can't remove your own membership from this org",
        code: "members.cant_remove_self",
      });
      return;
    }

    await removeMembership(membershipId);

    // activeMembershipId cleanup is handled inside removeMembership().
    // The user record itself is preserved because they may belong to
    // other orgs the caller can't see.

    res.status(204).send();
  },
);

export default router;
