import { and, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  partnersTable,
  partnerVendorRelationshipsTable,
  usersTable,
  userOrgMembershipsTable,
  vendorsTable,
  workHubChannelMembersTable,
} from "@workspace/db";
import type { SessionPayload } from "../lib/session";
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
  sameCompany: boolean;
};

type DirectoryMembership = {
  userId: number;
  orgType: string;
  vendorId: number | null;
  partnerId: number | null;
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

export async function listEligibleWorkHubPeople(
  actor: WorkHubDirectoryActor,
  search: string,
): Promise<WorkHubDirectoryPerson[]> {
  const scope = await directoryScope(actor);
  const candidateIds = [...scope.membershipByUser.keys()].filter((id) => id !== actor.userId);
  if (!candidateIds.length) return [];
  const term = search.trim();
  const users = await db
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
    .limit(50);
  const memberships = users
    .map((user) => scope.membershipByUser.get(user.id))
    .filter((membership): membership is DirectoryMembership => Boolean(membership));
  const vendorIds = [...new Set(memberships.flatMap((membership) => membership.vendorId ? [membership.vendorId] : []))];
  const partnerIds = [...new Set(memberships.flatMap((membership) => membership.partnerId ? [membership.partnerId] : []))];
  const vendorNames = vendorIds.length
    ? await db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable).where(inArray(vendorsTable.id, vendorIds))
    : [];
  const partnerNames = partnerIds.length
    ? await db.select({ id: partnersTable.id, name: partnersTable.name }).from(partnersTable).where(inArray(partnersTable.id, partnerIds))
    : [];
  const names = new Map<string, string>([
    ...vendorNames.map((vendor) => [`vendor:${vendor.id}`, vendor.name] as const),
    ...partnerNames.map((partner) => [`partner:${partner.id}`, partner.name] as const),
  ]);

  return users.flatMap((user) => {
    const membership = scope.membershipByUser.get(user.id);
    if (!membership || (membership.orgType !== "vendor" && membership.orgType !== "partner")) return [];
    const key = membershipKey(membership);
    return [{
      id: user.id,
      displayName: user.displayName,
      organizationName: names.get(key) ?? "Organization",
      organizationType: membership.orgType,
      role: membership.role,
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
