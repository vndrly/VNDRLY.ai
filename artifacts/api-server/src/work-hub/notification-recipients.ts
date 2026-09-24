import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, userOrgMembershipsTable, usersTable, vendorPeopleTable,
  managedSubcontractorRoleGrantsTable, managedSubcontractorWorkerSponsorshipsTable } from "@workspace/db";
import type { GateRole, SessionPayload } from "../lib/session";
import { isGateNotificationSession } from "../lib/gate-notification-policy";
import { resolveNotificationDestination } from "../lib/notification-destination";

/** Reconstruct authority from current memberships, never from an event's stale audience. */
export async function currentNotificationRecipients(
  owner: { type: "vendor" | "partner"; id: number },
  userIds: number[],
  link: string,
  gateOnly = false,
): Promise<number[]> {
  if (!userIds.length) return [];
  const memberships = await db.select().from(userOrgMembershipsTable).where(and(
    eq(userOrgMembershipsTable.orgType, owner.type),
    owner.type === "vendor" ? eq(userOrgMembershipsTable.vendorId, owner.id) : eq(userOrgMembershipsTable.partnerId, owner.id),
    inArray(userOrgMembershipsTable.userId, [...new Set(userIds)]),
  ));
  const allowed: number[] = [];
  for (const m of memberships) {
    const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, m.userId), isNull(usersTable.suspendedAt))).limit(1);
    if (!user) continue;
    const [person] = owner.type === "vendor" ? await db.select().from(vendorPeopleTable).where(and(
      eq(vendorPeopleTable.userId, m.userId), eq(vendorPeopleTable.vendorId, owner.id),
      eq(vendorPeopleTable.isActive, true), isNull(vendorPeopleTable.deletedAt),
    )).limit(1) : [];
    const grants = owner.type === "vendor" ? await db.select({ siteId: managedSubcontractorRoleGrantsTable.siteId, role: managedSubcontractorRoleGrantsTable.role })
      .from(managedSubcontractorWorkerSponsorshipsTable)
      .innerJoin(managedSubcontractorRoleGrantsTable, eq(managedSubcontractorRoleGrantsTable.sponsorshipId, managedSubcontractorWorkerSponsorshipsTable.id))
      .where(and(eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, m.userId), eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, owner.id),
        eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"), isNull(managedSubcontractorWorkerSponsorshipsTable.endedAt),
        eq(managedSubcontractorRoleGrantsTable.status, "active"), isNull(managedSubcontractorRoleGrantsTable.endedAt))) : [];
    const siteGrants = grants.filter((g): g is { siteId: number; role: GateRole } =>
      g.siteId != null && (g.role === "gatekeeper" || g.role === "gate_supervisor"));
    const session: SessionPayload & { userId: number } = {
      userId: m.userId, role: m.role === "field_employee" ? "field_employee" : owner.type,
      vendorId: m.vendorId ?? undefined, partnerId: m.partnerId ?? undefined,
      activeMembershipId: m.id, membershipRole: m.role, sv: user.sessionVersion,
      vendorRole: person?.vendorRole ?? undefined,
      ...(siteGrants.length ? { managedSubcontractor: { siteGrants } } : {}),
    };
    if (gateOnly && !isGateNotificationSession(session)) continue;
    if (await resolveNotificationDestination(session, link)) allowed.push(m.userId);
  }
  return [...new Set(allowed)];
}
