import { and, eq, inArray, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, workHubChannelsTable, workHubChannelMembersTable, userOrgMembershipsTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { resolveChannelAccess } from "./queries";
import { WorkHubAccessError } from "./context-access";
import { appendWorkHubAudit } from "./audit";

export const chatParticipantChange = z.object({
  addUserIds: z.array(z.number().int().positive()).max(100).default([]),
  removeUserIds: z.array(z.number().int().positive()).max(100).default([]),
}).strict().refine(p => !p.addUserIds.some(id => p.removeUserIds.includes(id)), "Conflicting participant changes");

export async function changeChatParticipants(actor: SessionPayload & { userId: number }, channelId: string, raw: unknown) {
  const change = chatParticipantChange.parse(raw);
  return db.transaction(async tx => {
    await tx.select().from(workHubChannelsTable).where(eq(workHubChannelsTable.id, channelId)).for("update");
    await validateAssistantSession(actor, tx);
    const { channel } = await resolveChannelAccess(actor, channelId, "channel.manage", tx);
    if (channel.contextKind !== "chat") throw new WorkHubAccessError("forbidden");
    const [admin] = await tx.select().from(userOrgMembershipsTable).where(and(
      eq(userOrgMembershipsTable.userId, actor.userId), eq(userOrgMembershipsTable.orgType, channel.ownerOrgType),
      eq(userOrgMembershipsTable.role, "admin"), channel.ownerOrgType === "vendor"
        ? eq(userOrgMembershipsTable.vendorId, channel.ownerOrgId) : eq(userOrgMembershipsTable.partnerId, channel.ownerOrgId),
    )).limit(1);
    if (channel.createdById !== actor.userId && !admin) throw new WorkHubAccessError("forbidden");
    if (change.removeUserIds.includes(channel.createdById)) throw new WorkHubAccessError("forbidden");
    const additions = [...new Set(change.addUserIds)].sort((a,b) => a-b);
    if (additions.length) {
      const eligible = await tx.select({ userId: userOrgMembershipsTable.userId }).from(userOrgMembershipsTable).where(and(
        inArray(userOrgMembershipsTable.userId, additions), eq(userOrgMembershipsTable.orgType, channel.ownerOrgType),
        channel.ownerOrgType === "vendor" ? eq(userOrgMembershipsTable.vendorId, channel.ownerOrgId) : eq(userOrgMembershipsTable.partnerId, channel.ownerOrgId),
      )).orderBy(asc(userOrgMembershipsTable.id)).for("share");
      if (additions.some(id => !eligible.some(m => m.userId === id))) throw new WorkHubAccessError("forbidden");
      await tx.insert(workHubChannelMembersTable).values(additions.map(userId => ({ channelId, userId, mode: "member" }))).onConflictDoNothing();
    }
    if (change.removeUserIds.length) await tx.delete(workHubChannelMembersTable).where(and(
      eq(workHubChannelMembersTable.channelId, channelId), inArray(workHubChannelMembersTable.userId, change.removeUserIds),
    ));
    await appendWorkHubAudit({ actorUserId: actor.userId, owner: { type: channel.ownerOrgType as "vendor" | "partner", id: channel.ownerOrgId },
      action: "chat.participants_changed", subjectType: "channel", subjectId: channelId, source: "web", metadata: change }, tx);
    return { saved: true };
  });
}
