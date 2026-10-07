import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  usersTable,
  userOrgMembershipsTable,
  workHubChannelsTable,
  workHubChannelMembersTable,
  workHubCollaborationChannelsTable,
  workHubCrewMembersTable,
} from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { resolveChannelAccess } from "./queries";
import {
  assertCollaborationInvite,
  collaborationChannelScope,
} from "./collaboration-access";
import { WorkHubAccessError } from "./context-access";
import { appendWorkHubAudit } from "./audit";

type Actor = SessionPayload & { userId: number };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const channelMemberInput = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .transform((value) => value.toLowerCase()),
  })
  .strict();

async function currentChannel(
  tx: Transaction,
  actor: Actor,
  channelId: string,
  userIds: number[] = [],
) {
  // Complete sorted user locks precede the channel, including the prospective member.
  const ids = [...new Set([actor.userId, ...userIds])].sort((a, b) => a - b);
  await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.id, ids))
    .orderBy(asc(usersTable.id))
    .for("update");
  await tx
    .select({ id: userOrgMembershipsTable.id })
    .from(userOrgMembershipsTable)
    .where(inArray(userOrgMembershipsTable.userId, ids))
    .orderBy(asc(userOrgMembershipsTable.id))
    .for("share");
  await tx
    .select({ id: workHubChannelsTable.id })
    .from(workHubChannelsTable)
    .where(eq(workHubChannelsTable.id, channelId))
    .for("update");
  await tx
    .select({ id: workHubChannelMembersTable.id })
    .from(workHubChannelMembersTable)
    .where(eq(workHubChannelMembersTable.channelId, channelId))
    .orderBy(asc(workHubChannelMembersTable.id))
    .for("share");
  const scopes = await tx
    .select()
    .from(workHubCollaborationChannelsTable)
    .where(eq(workHubCollaborationChannelsTable.channelId, channelId))
    .for("share");
  if (scopes[0]?.crewId)
    await tx
      .select({ id: workHubCrewMembersTable.id })
      .from(workHubCrewMembersTable)
      .where(eq(workHubCrewMembersTable.crewId, scopes[0].crewId))
      .orderBy(asc(workHubCrewMembersTable.id))
      .for("share");
  try {
    await validateAssistantSession(actor, tx);
  } catch {
    throw new WorkHubAccessError("forbidden");
  }
  return resolveChannelAccess(actor, channelId, "channel.read", tx);
}

export async function readChannelMembers(actor: Actor, channelId: string) {
  return db.transaction(async (tx) => {
    await currentChannel(tx, actor, channelId);
    return tx
      .select({
        id: workHubChannelMembersTable.id,
        userId: usersTable.id,
        displayName: usersTable.displayName,
        email: usersTable.email,
        mode: workHubChannelMembersTable.mode,
      })
      .from(workHubChannelMembersTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, workHubChannelMembersTable.userId),
      )
      .where(eq(workHubChannelMembersTable.channelId, channelId));
  });
}

export async function readChannelMemberAccess(actor: Actor, channelId: string) {
  return db.transaction(async (tx) => {
    await currentChannel(tx, actor, channelId);
    const scope = await collaborationChannelScope(actor.userId, channelId, tx);
    if (scope?.kind === "chat") return { canManage: false };
    try {
      await resolveChannelAccess(actor, channelId, "channel.manage", tx);
      return { canManage: true };
    } catch (error) {
      if (error instanceof WorkHubAccessError && error.status === 403)
        return { canManage: false };
      throw error;
    }
  });
}

export async function addChannelMember(
  actor: Actor,
  channelId: string,
  raw: unknown,
  source: "web" | "ios",
) {
  const { email } = channelMemberInput.parse(raw);
  return db.transaction(async (tx) => {
    // Exact lookup returns no directory data; authorization is checked before any result.
    const [invitee] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        sql`lower(coalesce(${usersTable.email}, ${usersTable.username})) = ${email}`,
      )
      .limit(1);
    await currentChannel(tx, actor, channelId, invitee ? [invitee.id] : []);
    const { channel } = await resolveChannelAccess(
      actor,
      channelId,
      "channel.manage",
      tx,
    );
    if (!invitee) return null;
    // Recheck the exact identity after locking it, avoiding a changed email lookup.
    const [currentInvitee] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, invitee.id),
          sql`lower(coalesce(${usersTable.email}, ${usersTable.username})) = ${email}`,
        ),
      )
      .limit(1);
    if (!currentInvitee) throw new WorkHubAccessError("forbidden");
    await assertCollaborationInvite(channel, invitee.id, tx);
    const [existing] = await tx
      .select()
      .from(workHubChannelMembersTable)
      .where(
        and(
          eq(workHubChannelMembersTable.channelId, channelId),
          eq(workHubChannelMembersTable.userId, invitee.id),
        ),
      )
      .limit(1);
    if (existing) return existing; // Preserve owner mode; no second effect or audit.
    const [member] = await tx
      .insert(workHubChannelMembersTable)
      .values({ channelId, userId: invitee.id, mode: "member" })
      .returning();
    await appendWorkHubAudit(
      {
        actorUserId: actor.userId,
        owner: {
          type: channel.ownerOrgType as "vendor" | "partner",
          id: channel.ownerOrgId,
        },
        action: "channel.member_added",
        subjectType: "channel",
        subjectId: channelId,
        source,
        metadata: { invitedUserId: invitee.id },
      },
      tx,
    );
    return member;
  });
}
