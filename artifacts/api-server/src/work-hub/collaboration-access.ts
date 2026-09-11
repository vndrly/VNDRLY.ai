import { and, eq } from "drizzle-orm";
import {
  db,
  workHubChannelMembersTable,
  workHubCollaborationChannelsTable,
  workHubCrewMembersTable,
  userOrgMembershipsTable,
  workHubCrewsTable,
} from "@workspace/db";
import { canReadCollaborationChannel } from "./collaboration-policy";
import { WorkHubAccessError } from "./context-access";

export async function collaborationChannelScope(
  userId: number,
  channelId: string,
) {
  const [scope] = await db
    .select()
    .from(workHubCollaborationChannelsTable)
    .where(eq(workHubCollaborationChannelsTable.channelId, channelId))
    .limit(1);
  if (!scope) return null;
  const [member] = await db
    .select()
    .from(workHubChannelMembersTable)
    .where(
      and(
        eq(workHubChannelMembersTable.channelId, channelId),
        eq(workHubChannelMembersTable.userId, userId),
      ),
    )
    .limit(1);
  const crewMember = scope.crewId
    ? (
        await db
          .select()
          .from(workHubCrewMembersTable)
          .where(
            and(
              eq(workHubCrewMembersTable.crewId, scope.crewId),
              eq(workHubCrewMembersTable.userId, userId),
            ),
          )
          .limit(1)
      )[0]
    : null;
  if (scope.crewId && scope.kind !== "shared") {
    const [crew] = await db
      .select()
      .from(workHubCrewsTable)
      .where(eq(workHubCrewsTable.id, scope.crewId))
      .limit(1);
    const [company] = crew
      ? await db
          .select()
          .from(userOrgMembershipsTable)
          .where(
            and(
              eq(userOrgMembershipsTable.userId, userId),
              eq(userOrgMembershipsTable.orgType, crew.ownerOrgType),
              crew.ownerOrgType === "vendor"
                ? eq(userOrgMembershipsTable.vendorId, crew.ownerOrgId)
                : eq(userOrgMembershipsTable.partnerId, crew.ownerOrgId),
            ),
          )
          .limit(1)
      : [];
    if (!company) return { ...scope, readable: false, manager: false };
  }
  return {
    ...scope,
    readable: canReadCollaborationChannel(
      scope.kind,
      Boolean(member),
      Boolean(crewMember),
    ),
    manager:
      member?.mode === "owner" ||
      (scope.kind === "crew" && crewMember?.mode === "owner"),
  };
}
/** null preserves existing channel behavior. */
export async function collaborationChannelAccess(
  userId: number,
  channelId: string,
): Promise<boolean | null> {
  return (await collaborationChannelScope(userId, channelId))?.readable ?? null;
}
/** Existing membership endpoint must never bypass chat consent or private Crew membership. */
export async function assertCollaborationInvite(
  channel: { id: string; ownerOrgType: string; ownerOrgId: number },
  inviteeId: number,
) {
  const scope = await collaborationChannelScope(inviteeId, channel.id);
  if (!scope) return;
  if (scope.kind === "chat") throw new WorkHubAccessError("forbidden");
  if (scope.kind === "shared") {
    // Sharing is limited to a person already in the owning company. External sharing
    // uses the explicit accepted invitation flow, never a generic email addition.
    const [org] = await db
      .select()
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.userId, inviteeId),
          eq(userOrgMembershipsTable.orgType, channel.ownerOrgType),
          channel.ownerOrgType === "vendor"
            ? eq(userOrgMembershipsTable.vendorId, channel.ownerOrgId)
            : eq(userOrgMembershipsTable.partnerId, channel.ownerOrgId),
        ),
      )
      .limit(1);
    if (!org) throw new WorkHubAccessError("forbidden");
    return;
  }
  const [crew] = await db
    .select()
    .from(workHubCrewMembersTable)
    .where(
      and(
        eq(workHubCrewMembersTable.crewId, scope.crewId!),
        eq(workHubCrewMembersTable.userId, inviteeId),
      ),
    )
    .limit(1);
  if (!crew) throw new WorkHubAccessError("forbidden");
}
