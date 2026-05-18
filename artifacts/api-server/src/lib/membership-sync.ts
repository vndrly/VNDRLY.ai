// Reusable helpers for managing `user_org_memberships` and the
// associated `users.activeMembershipId` pointer. Call these from every
// code path that attaches/removes a login to/from a Partner or Vendor
// org so the dual-membership picker/switcher works for non-demo users
// too. `user_org_memberships` is the single source of truth for which
// org(s) a user belongs to.

import { db } from "@workspace/db";
import {
  usersTable,
  userOrgMembershipsTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";

export type OrgType = "partner" | "vendor";
export type MembershipRole = "admin" | "member" | "ap" | "field_employee";

/**
 * Either the top-level `db` or a transaction handle from
 * `db.transaction(...)`. Both support the same query/insert/update
 * surface used by the membership helpers, so callers can pass a `tx`
 * to keep user creation + membership attach in a single transaction.
 */
export type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

interface AddMembershipParams {
  userId: number;
  orgType: OrgType;
  orgId: number;
  role: MembershipRole;
  /** Required for field_employee memberships, otherwise null. */
  vendorPeopleId?: number | null;
}

/**
 * Idempotently attach a user to a partner or vendor org. If the
 * membership row already exists its role/vendorPeopleId are updated to
 * match the requested values. When the user has no `activeMembershipId`
 * yet (e.g. brand-new login) we point it at this membership so the
 * post-login picker is skipped for single-org users.
 *
 * Pass `executor` (a `tx` from `db.transaction(...)`) when the caller
 * is also creating the user row in the same transaction so the user +
 * membership commit or roll back together. Defaults to the top-level
 * `db` for callers that don't run inside a transaction.
 *
 * Returns the membership row id.
 */
export async function addMembership(
  params: AddMembershipParams,
  executor: DbExecutor = db,
): Promise<number> {
  const { userId, orgType, orgId, role } = params;
  const vendorPeopleId = params.vendorPeopleId ?? null;
  const partnerId = orgType === "partner" ? orgId : null;
  const vendorId = orgType === "vendor" ? orgId : null;

  const inserted = await executor
    .insert(userOrgMembershipsTable)
    .values({
      userId,
      orgType,
      partnerId,
      vendorId,
      role,
      vendorPeopleId,
    })
    .onConflictDoNothing()
    .returning({ id: userOrgMembershipsTable.id });

  let membershipId: number;
  if (inserted[0]) {
    membershipId = inserted[0].id;
  } else {
    const [existing] = await executor
      .select({
        id: userOrgMembershipsTable.id,
        role: userOrgMembershipsTable.role,
        vendorPeopleId: userOrgMembershipsTable.vendorPeopleId,
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
    if (!existing) {
      throw new Error("Failed to add or find membership");
    }
    membershipId = existing.id;
    if (
      existing.role !== role ||
      existing.vendorPeopleId !== vendorPeopleId
    ) {
      await executor
        .update(userOrgMembershipsTable)
        .set({ role, vendorPeopleId })
        .where(eq(userOrgMembershipsTable.id, membershipId));
    }
  }

  // If this is the user's first / only active context, point
  // `activeMembershipId` at this membership so the post-login picker
  // is skipped for single-org users.
  const [user] = await executor
    .select({
      id: usersTable.id,
      activeMembershipId: usersTable.activeMembershipId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (user && user.activeMembershipId === null) {
    await executor
      .update(usersTable)
      .set({ activeMembershipId: membershipId })
      .where(eq(usersTable.id, userId));
  }

  return membershipId;
}

/**
 * Remove a membership row and keep `users.activeMembershipId`
 * coherent. If the removed membership was active, the user's first
 * remaining membership becomes active so they keep a working session
 * without going through the picker again.
 *
 * The FK on `users.activeMembershipId` already SET NULLs on delete so
 * this function is safe to call even if you only care about the row
 * removal — the active-membership repointing is the value-add.
 *
 * Returns the deleted membership row, or null if nothing was removed.
 */
export async function removeMembership(
  membershipId: number,
): Promise<typeof userOrgMembershipsTable.$inferSelect | null> {
  const [removed] = await db
    .delete(userOrgMembershipsTable)
    .where(eq(userOrgMembershipsTable.id, membershipId))
    .returning();
  if (!removed) return null;

  const [user] = await db
    .select({
      id: usersTable.id,
      activeMembershipId: usersTable.activeMembershipId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, removed.userId))
    .limit(1);

  if (!user) return removed;

  // Invalidate any previously-issued session tokens for this user so
  // that stale Bearer tokens cannot continue accessing the org after
  // the membership is removed.
  await db
    .update(usersTable)
    .set({ sessionVersion: sql`${usersTable.sessionVersion} + 1` })
    .where(eq(usersTable.id, user.id));

  // The FK already nulled activeMembershipId if it pointed at the
  // removed row. Re-point at the next remaining membership when one
  // exists so the user keeps a working session without going through
  // the picker again.
  if (user.activeMembershipId === null) {
    const [next] = await db
      .select({ id: userOrgMembershipsTable.id })
      .from(userOrgMembershipsTable)
      .where(eq(userOrgMembershipsTable.userId, user.id))
      .orderBy(asc(userOrgMembershipsTable.id))
      .limit(1);
    if (next) {
      await db
        .update(usersTable)
        .set({ activeMembershipId: next.id })
        .where(eq(usersTable.id, user.id));
    }
  }

  return removed;
}
