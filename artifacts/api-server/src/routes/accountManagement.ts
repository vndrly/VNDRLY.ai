// Admin-side account management for the Employees flow.
//
// Three endpoints, all guarded by the same permission model:
//   System Admin (role=admin)                — any user
//   Partner Admin (role=partner+membershipRole=admin)
//                                            — users with a membership in
//                                              their partner org
//   Vendor Admin (role=vendor+membershipRole=admin)
//                                            — users with a membership in
//                                              their vendor org
//
// All three bump users.session_version, which the cookie/JWT middleware
// uses to invalidate every existing session for that user (so a
// suspended user is signed out everywhere on their next request).

import { Router, type IRouter, type Request } from "express";
import { eq, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  db,
  usersTable,
  userOrgMembershipsTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { sendAdminResetPasswordEmail } from "../lib/sendgrid";
import { logger } from "../lib/logger";
import { canManageVendorPeople } from "../lib/vendor-people-management";
import { userIsVendorOffice } from "../lib/office-role";

const router: IRouter = Router();

interface AdminContext {
  adminUserId: number;
  adminDisplayName: string;
}

/**
 * Verify the requester is allowed to manage account settings on the
 * target user. Returns the requester's display name on success, or an
 * HTTP-style {status, code, message} on failure.
 */
async function authorizeAdminFor(
  req: Request,
  targetUserId: number,
): Promise<
  | { ok: true; ctx: AdminContext }
  | { ok: false; status: number; code: string; message: string }
> {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    return {
      ok: false,
      status: 401,
      code: "auth.unauthenticated",
      message: "Not authenticated",
    };
  }

  // System admin — short-circuit.
  if (session.role === "admin") {
    const [me] = await db
      .select({ displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.id, session.userId));
    return {
      ok: true,
      ctx: {
        adminUserId: session.userId,
        adminDisplayName: me?.displayName ?? "Administrator",
      },
    };
  }

  // Partner / vendor admin — must have membershipRole=admin AND share an
  // org with the target. Vendor office staff may also manage logins on
  // their vendor. Foremen may reset passwords for teammates on their vendor.
  if (session.role === "vendor" && session.vendorId) {
    const sameVendor = await db
      .select({ id: userOrgMembershipsTable.id })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.userId, targetUserId),
          eq(userOrgMembershipsTable.orgType, "vendor"),
          eq(userOrgMembershipsTable.vendorId, session.vendorId),
        ),
      )
      .limit(1);
    if (sameVendor.length > 0) {
      const officeOk =
        session.membershipRole === "admin" ||
        (await userIsVendorOffice(session.userId, session.vendorId)) ||
        (await canManageVendorPeople(
          {
            userId: session.userId,
            role: session.role,
            vendorId: session.vendorId,
            membershipRole: session.membershipRole,
            vendorRole: session.vendorRole,
            vendorPeopleId: session.vendorPeopleId,
          },
          session.vendorId,
        ));
      if (officeOk) {
        const [me] = await db
          .select({ displayName: usersTable.displayName })
          .from(usersTable)
          .where(eq(usersTable.id, session.userId));
        return {
          ok: true,
          ctx: {
            adminUserId: session.userId,
            adminDisplayName: me?.displayName ?? "Administrator",
          },
        };
      }
    }
  }

  if (
    (session.role !== "partner" && session.role !== "vendor") ||
    session.membershipRole !== "admin"
  ) {
    return {
      ok: false,
      status: 403,
      code: "accounts.forbidden",
      message: "Admin access required",
    };
  }

  const orgType = session.role; // "partner" | "vendor"
  const orgId = orgType === "partner" ? session.partnerId : session.vendorId;
  if (!orgId) {
    return {
      ok: false,
      status: 403,
      code: "accounts.forbidden",
      message: "Admin access required",
    };
  }

  const sameOrg = await db
    .select({ id: userOrgMembershipsTable.id })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.userId, targetUserId),
        eq(userOrgMembershipsTable.orgType, orgType),
        orgType === "partner"
          ? eq(userOrgMembershipsTable.partnerId, orgId)
          : eq(userOrgMembershipsTable.vendorId, orgId),
      ),
    )
    .limit(1);

  if (sameOrg.length === 0) {
    return {
      ok: false,
      status: 403,
      code: "accounts.forbidden",
      message: "Cross-organization access denied",
    };
  }

  const [me] = await db
    .select({ displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId));
  return {
    ok: true,
    ctx: {
      adminUserId: session.userId,
      adminDisplayName: me?.displayName ?? "Administrator",
    },
  };
}

function parseUserId(req: Request): number | null {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

// ─── Reset password ────────────────────────────────────────────
//
// Admin types a temp password and the system emails it to the user.
// must_change_password=true forces the user to pick a new one on next
// login. session_version is bumped so any active session for the user
// is killed.

router.post("/users/:id/admin-reset-password", async (req, res) => {
  const targetUserId = parseUserId(req);
  if (!targetUserId) {
    res.status(400).json({ message: "Invalid user id", code: "accounts.bad_id" });
    return;
  }
  const tempPassword = String(req.body?.tempPassword ?? "");
  const mustChangePassword = req.body?.mustChangePassword !== false;
  if (tempPassword.length < 8) {
    res.status(400).json({
      message: "Temporary password must be at least 8 characters",
      code: "accounts.weak_password",
    });
    return;
  }

  const auth = await authorizeAdminFor(req, targetUserId);
  if (!auth.ok) {
    res.status(auth.status).json({ message: auth.message, code: auth.code });
    return;
  }

  const [target] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      preferredLanguage: usersTable.preferredLanguage,
    })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));

  if (!target) {
    res.status(404).json({ message: "User not found", code: "accounts.not_found" });
    return;
  }

  const hash = await bcrypt.hash(tempPassword, 10);
  await db
    .update(usersTable)
    .set({
      passwordHash: hash,
      mustChangePassword,
      sessionVersion: sql`${usersTable.sessionVersion} + 1`,
    })
    .where(eq(usersTable.id, targetUserId));

  const locale =
    target.preferredLanguage === "es" ? ("es" as const) : ("en" as const);
  try {
    await sendAdminResetPasswordEmail({
      to: target.username,
      displayName: target.displayName ?? target.username,
      adminDisplayName: auth.ctx.adminDisplayName,
      tempPassword,
      locale,
    });
  } catch (err) {
    logger.error(
      { err, targetUserId },
      "Failed to send admin-reset-password email",
    );
    // Still 200: the password was rotated. Surface a flag so the UI can
    // tell the admin to share the temp password manually if needed.
    res.json({
      ok: true,
      emailSent: false,
      message: "Password reset, but email delivery failed", code: "accounts.email_delivery_failed",
    });
    return;
  }

  res.json({ ok: true, emailSent: true });
});

// ─── Suspend ────────────────────────────────────────────────────

router.post("/users/:id/suspend", async (req, res) => {
  const targetUserId = parseUserId(req);
  if (!targetUserId) {
    res.status(400).json({ message: "Invalid user id", code: "accounts.bad_id" });
    return;
  }
  const auth = await authorizeAdminFor(req, targetUserId);
  if (!auth.ok) {
    res.status(auth.status).json({ message: auth.message, code: auth.code });
    return;
  }

  const [target] = await db
    .select({ id: usersTable.id, suspendedAt: usersTable.suspendedAt })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (!target) {
    res.status(404).json({ message: "User not found", code: "accounts.not_found" });
    return;
  }

  await db
    .update(usersTable)
    .set({
      suspendedAt: new Date(),
      suspendedBy: auth.ctx.adminUserId,
      sessionVersion: sql`${usersTable.sessionVersion} + 1`,
    })
    .where(eq(usersTable.id, targetUserId));

  res.json({ ok: true, suspendedAt: new Date().toISOString() });
});

// ─── Reactivate ─────────────────────────────────────────────────

router.post("/users/:id/reactivate", async (req, res) => {
  const targetUserId = parseUserId(req);
  if (!targetUserId) {
    res.status(400).json({ message: "Invalid user id", code: "accounts.bad_id" });
    return;
  }
  const auth = await authorizeAdminFor(req, targetUserId);
  if (!auth.ok) {
    res.status(auth.status).json({ message: auth.message, code: auth.code });
    return;
  }

  const [target] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (!target) {
    res.status(404).json({ message: "User not found", code: "accounts.not_found" });
    return;
  }

  await db
    .update(usersTable)
    .set({
      suspendedAt: null,
      suspendedBy: null,
      // Bump sv so any leftover session token from before they were
      // suspended is also rotated. (Belt-and-suspenders.)
      sessionVersion: sql`${usersTable.sessionVersion} + 1`,
    })
    .where(eq(usersTable.id, targetUserId));

  res.json({ ok: true });
});

export default router;
