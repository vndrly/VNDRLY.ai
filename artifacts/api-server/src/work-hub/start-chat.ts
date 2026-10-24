import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, usersTable, userOrgMembershipsTable, workHubChannelsTable, workHubChannelMembersTable, workHubCollaborationChannelsTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { WorkHubAccessError } from "./context-access";

export const startChatPayload = z.object({
  participantUserIds: z.array(z.number().int().positive()).min(1).max(100),
  name: z.string().trim().max(120).optional(),
  operationId: z.string().uuid(),
}).strict();

// Create the conversation and its exact participant list atomically, never extend an existing pair chat.
export async function startChat(actor: SessionPayload & { userId: number }, raw: unknown) {
  const input = startChatPayload.parse(raw);
  const ids = [...new Set(input.participantUserIds)].filter(id => id !== actor.userId);
  if (!ids.length) throw new WorkHubAccessError("forbidden");
  return db.transaction(async tx => {
    await validateAssistantSession(actor, tx);
    const type = actor.vendorId ? "vendor" : "partner";
    const ownerId = actor.vendorId || actor.partnerId;
    if (!ownerId) throw new WorkHubAccessError("forbidden");
    const members = await tx.select({ userId: userOrgMembershipsTable.userId }).from(userOrgMembershipsTable).where(and(
      inArray(userOrgMembershipsTable.userId, [actor.userId, ...ids]),
      eq(userOrgMembershipsTable.orgType, type),
      type === "vendor" ? eq(userOrgMembershipsTable.vendorId, ownerId) : eq(userOrgMembershipsTable.partnerId, ownerId),
    )).for("share");
    if ([actor.userId, ...ids].some(id => !members.some(m => m.userId === id))) throw new WorkHubAccessError("forbidden");
    const contextId = `chat:${actor.userId}:${input.operationId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${contextId}))`);
    const [existing] = await tx.select().from(workHubChannelsTable).where(and(
      eq(workHubChannelsTable.contextKind, "chat"), eq(workHubChannelsTable.contextId, contextId),
      eq(workHubChannelsTable.ownerOrgType, type), eq(workHubChannelsTable.ownerOrgId, ownerId),
    )).limit(1);
    if (existing) return { channel: existing };
    const people = await tx.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(inArray(usersTable.id, ids));
    const name = input.name || people.map(p => p.displayName).join(", ").slice(0, 120) || "Chat";
    const [channel] = await tx.insert(workHubChannelsTable).values({ ownerOrgType: type, ownerOrgId: ownerId,
      contextKind: "chat", contextId, name, visibility: "private", createdById: actor.userId }).returning();
    await tx.insert(workHubCollaborationChannelsTable).values({ channelId: channel.id, kind: "chat" });
    await tx.insert(workHubChannelMembersTable).values([
      { channelId: channel.id, userId: actor.userId, mode: "owner" },
      ...ids.map(userId => ({ channelId: channel.id, userId, mode: "member" })),
    ]);
    return { channel };
  });
}
