import { and, asc, desc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import {
  db,
  managedSubcontractorOrganizationsTable as managedOrganizations,
  managedSubcontractorRoleGrantsTable as managedGrants,
  managedSubcontractorSponsorsTable as managedSponsors,
  managedSubcontractorWorkerSponsorshipsTable as managedWorkers,
  partnersTable,
  partnerVendorRelationshipsTable,
  usersTable,
  userOrgMembershipsTable,
  vendorPeopleTable,
  vendorPersonOperationalRolesTable,
  vendorsTable,
  workHubCallSettingsTable,
  workHubChannelMembersTable,
} from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { legacyOperationalRoles } from "../lib/vendor-person-access";
import { WorkHubAccessError } from "./context-access";
import { listOwnedWorkHubChannels } from "./queries";

export type WorkHubDirectoryActor = Pick<
  SessionPayload,
  "role" | "membershipRole" | "vendorId" | "partnerId"
> & { userId: number };

export type WorkHubDirectoryPerson = {
  id: number;
  displayName: string;
  organizationName: string;
  organizationType: "vendor" | "partner";
  role: string;
  operationalRole?: string;
  sameCompany: boolean;
};

type DirectoryMembership = {
  userId: number;
  orgType: string;
  vendorId: number | null;
  partnerId: number | null;
  vendorPeopleId: number | null;
  role: string;
};

function activeOwner(actor: WorkHubDirectoryActor) {
  if (actor.vendorId) return { type: "vendor" as const, id: actor.vendorId };
  if (actor.partnerId) return { type: "partner" as const, id: actor.partnerId };
  throw new WorkHubAccessError("forbidden");
}

function membershipKey(membership: DirectoryMembership) {
  return membership.orgType === "vendor"
    ? `vendor:${membership.vendorId}`
    : `partner:${membership.partnerId}`;
}

async function directoryScope(actor: WorkHubDirectoryActor) {
  const owner = activeOwner(actor);
  const relationships = await db
    .select({
      vendorId: partnerVendorRelationshipsTable.vendorId,
      partnerId: partnerVendorRelationshipsTable.partnerId,
    })
    .from(partnerVendorRelationshipsTable)
    .where(
      and(
        eq(partnerVendorRelationshipsTable.status, "approved"),
        owner.type === "vendor"
          ? eq(partnerVendorRelationshipsTable.vendorId, owner.id)
          : eq(partnerVendorRelationshipsTable.partnerId, owner.id),
      ),
    );
  const allowedOrgKeys = new Set<string>([`${owner.type}:${owner.id}`]);
  for (const relationship of relationships) {
    allowedOrgKeys.add(
      owner.type === "vendor"
        ? `partner:${relationship.partnerId}`
        : `vendor:${relationship.vendorId}`,
    );
  }

  const memberships = (await db.select().from(userOrgMembershipsTable)) as DirectoryMembership[];
  const channels = await listOwnedWorkHubChannels(actor, undefined, 100);
  const peerRows = channels.length
    ? await db
        .select({ userId: workHubChannelMembersTable.userId })
        .from(workHubChannelMembersTable)
        .where(
          inArray(
            workHubChannelMembersTable.channelId,
            channels.map((channel) => channel.id),
          ),
        )
    : [];
  const peerIds = new Set(peerRows.map((row) => row.userId));
  const eligibleMemberships = memberships.filter(
    (membership) =>
      allowedOrgKeys.has(membershipKey(membership)) || peerIds.has(membership.userId),
  );
  const membershipByUser = new Map<number, DirectoryMembership>();
  for (const membership of eligibleMemberships) {
    const current = membershipByUser.get(membership.userId);
    if (!current || allowedOrgKeys.has(membershipKey(membership))) {
      membershipByUser.set(membership.userId, membership);
    }
  }
  return {
    owner,
    membershipByUser,
  };
}

const operationalRoleOrder = [
  "gate_supervisor", "gatekeeper", "foreman", "managed_company_manager",
  "asset_manager", "safety_manager", "field_employee", "office",
];

function preferredOperationalRole(roles: readonly (string | null)[]) {
  return operationalRoleOrder.find(role => roles.includes(role));
}

async function loadManagedDirectoryProfiles(vendorId: number | null | undefined, memberships: DirectoryMembership[]) {
  const workerIds = memberships.filter(member => member.vendorId === vendorId).map(member => member.userId);
  if (!vendorId || !workerIds.length) return [];
  return db.select({
    userId: managedWorkers.workerUserId,
    sponsorshipId: managedWorkers.id,
    organizationName: managedOrganizations.name,
    role: managedGrants.role,
  })
    .from(managedWorkers)
    .innerJoin(managedOrganizations, eq(managedOrganizations.id, managedWorkers.managedOrganizationId))
    .innerJoin(managedSponsors, and(
      eq(managedSponsors.managedOrganizationId, managedWorkers.managedOrganizationId),
      eq(managedSponsors.sponsorVendorId, managedWorkers.sponsorVendorId),
      eq(managedSponsors.status, "active"),
    ))
    .leftJoin(managedGrants, and(
      eq(managedGrants.sponsorshipId, managedWorkers.id),
      eq(managedGrants.status, "active"),
    ))
    .where(and(
      eq(managedWorkers.sponsorVendorId, vendorId),
      inArray(managedWorkers.workerUserId, workerIds),
      eq(managedWorkers.status, "active"),
      ne(managedOrganizations.status, "archived"),
    ))
    .orderBy(desc(managedWorkers.createdAt), asc(managedWorkers.id));
}

async function loadDirectoryStaffProfiles(vendorIds: number[], memberships: DirectoryMembership[]) {
  if (!vendorIds.length) return [];
  const vendorMemberships = memberships.filter(member => member.orgType === "vendor");
  const userIds = vendorMemberships.map(member => member.userId);
  const personIds = vendorMemberships.flatMap(member => member.vendorPeopleId == null ? [] : [member.vendorPeopleId]);
  return db.select({
    id: vendorPeopleTable.id,
    userId: vendorPeopleTable.userId,
    vendorId: vendorPeopleTable.vendorId,
    legacyRole: vendorPeopleTable.vendorRole,
    role: vendorPersonOperationalRolesTable.role,
  })
    .from(vendorPeopleTable)
    .leftJoin(vendorPersonOperationalRolesTable, and(
      eq(vendorPersonOperationalRolesTable.vendorPeopleId, vendorPeopleTable.id),
      eq(vendorPersonOperationalRolesTable.isActive, true),
    ))
    .where(and(
      inArray(vendorPeopleTable.vendorId, vendorIds),
      or(inArray(vendorPeopleTable.userId, userIds), personIds.length ? inArray(vendorPeopleTable.id, personIds) : undefined),
      eq(vendorPeopleTable.isActive, true),
      isNull(vendorPeopleTable.deletedAt),
    ));
}

export async function listEligibleWorkHubPeople(
  actor: WorkHubDirectoryActor,
  search: string,
  options: { prioritizeSpeedDial?: boolean; includeAll?: boolean } = {},
): Promise<WorkHubDirectoryPerson[]> {
  const scope = await directoryScope(actor);
  const candidateIds = [...scope.membershipByUser.keys()].filter((id) => id !== actor.userId);
  if (!candidateIds.length) return [];
  const term = search.trim();
  const [callSettings] = options.prioritizeSpeedDial
    ? await db.select({ speedDial: workHubCallSettingsTable.speedDial }).from(workHubCallSettingsTable)
      .where(eq(workHubCallSettingsTable.userId, actor.userId)).limit(1)
    : [];
  const speedDial = callSettings?.speedDial ?? [];
  const usersQuery = db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.id, candidateIds),
        isNull(usersTable.suspendedAt),
        term
          ? or(
              ilike(usersTable.displayName, `%${term}%`),
              ilike(usersTable.email, `%${term}%`),
            )
          : undefined,
      ),
    )
    .orderBy(...(speedDial.length ? [desc(inArray(usersTable.id, speedDial)), asc(usersTable.id)] : []));
  const users = await (options.includeAll ? usersQuery : usersQuery.limit(50));
  const memberships = users
    .map((user) => scope.membershipByUser.get(user.id))
    .filter((membership): membership is DirectoryMembership => Boolean(membership));
  const vendorIds = [...new Set(memberships.flatMap((membership) => membership.vendorId ? [membership.vendorId] : []))];
  const partnerIds = [...new Set(memberships.flatMap((membership) => membership.partnerId ? [membership.partnerId] : []))];
  const [vendorNames, partnerNames, managedProfiles, staffProfiles] = await Promise.all([
    vendorIds.length
      ? db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable).where(inArray(vendorsTable.id, vendorIds))
      : [],
    partnerIds.length
      ? db.select({ id: partnersTable.id, name: partnersTable.name }).from(partnersTable).where(inArray(partnersTable.id, partnerIds))
      : [],
    loadManagedDirectoryProfiles(actor.vendorId, memberships),
    loadDirectoryStaffProfiles(vendorIds, memberships),
  ]);
  const names = new Map<string, string>([
    ...vendorNames.map((vendor) => [`vendor:${vendor.id}`, vendor.name] as const),
    ...partnerNames.map((partner) => [`partner:${partner.id}`, partner.name] as const),
  ]);

  return users.flatMap((user) => {
    const membership = scope.membershipByUser.get(user.id);
    if (!membership || (membership.orgType !== "vendor" && membership.orgType !== "partner")) return [];
    const key = membershipKey(membership);
    const managed = managedProfiles.find(profile => profile.userId === user.id);
    const staff = staffProfiles.filter(profile =>
      profile.vendorId === membership.vendorId &&
      (profile.userId === user.id || (profile.userId === null && profile.id === membership.vendorPeopleId)),
    );
    const staffRoles = staff.flatMap(profile => profile.role ? [profile.role] : []);
    const operationalRole = managed
      ? preferredOperationalRole(managedProfiles.filter(profile => profile.sponsorshipId === managed.sponsorshipId).map(profile => profile.role))
      : ["admin", "ap"].includes(membership.role)
        ? undefined
        : preferredOperationalRole(staffRoles.length ? staffRoles : legacyOperationalRoles(staff[0]?.legacyRole));
    return [{
      id: user.id,
      displayName: user.displayName,
      organizationName: managed?.organizationName ?? names.get(key) ?? "Organization",
      organizationType: membership.orgType,
      role: membership.role,
      ...(operationalRole ? { operationalRole } : {}),
      sameCompany: key === `${scope.owner.type}:${scope.owner.id}`,
    }];
  });
}

export async function resolveWorkHubInviteEligibility(
  actor: WorkHubDirectoryActor,
  recipientUserId: number,
): Promise<{ sameCompany: boolean; relationshipScoped: boolean }> {
  if (recipientUserId === actor.userId) throw new WorkHubAccessError("forbidden");
  const scope = await directoryScope(actor);
  const membership = scope.membershipByUser.get(recipientUserId);
  if (!membership) throw new WorkHubAccessError("forbidden");
  const [recipient] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, recipientUserId), isNull(usersTable.suspendedAt)))
    .limit(1);
  if (!recipient) throw new WorkHubAccessError("forbidden");
  const sameCompany = membershipKey(membership) === `${scope.owner.type}:${scope.owner.id}`;
  return { sameCompany, relationshipScoped: !sameCompany };
}
