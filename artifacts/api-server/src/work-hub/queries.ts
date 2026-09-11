import { and, desc, eq, lt, or } from "drizzle-orm";
import { db, siteLocationsTable, ticketsTable, workHubChannelMembersTable, workHubChannelsTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { createWorkHubAccess, requireWorkHubCapability, type WorkHubAccess } from "./context-access";
import type { WorkHubCapability } from "@workspace/api-zod";
import { collaborationChannelAccess, collaborationChannelScope } from "./collaboration-access";

export async function isWorkHubParticipant(session: SessionPayload & { userId: number }, channel: typeof workHubChannelsTable.$inferSelect): Promise<boolean> {
  const collaborationAccess = await collaborationChannelAccess(session.userId, channel.id);
  if (collaborationAccess !== null) return collaborationAccess;
  if (session.role === "admin") return true;
  const ownerMatch = channel.ownerOrgType === "vendor"
    ? session.vendorId === channel.ownerOrgId
    : session.partnerId === channel.ownerOrgId;
  if (ownerMatch && session.membershipRole === "admin") return true;
  const [membership] = await db.select({ id: workHubChannelMembersTable.id })
    .from(workHubChannelMembersTable)
    .where(and(eq(workHubChannelMembersTable.channelId, channel.id), eq(workHubChannelMembersTable.userId, session.userId)))
    .limit(1);
  if (membership) return true;
  if (channel.visibility === "organization" && ownerMatch) return true;
  if (channel.contextKind === "ticket") {
    const ticketId = Number(channel.contextId);
    if (!Number.isInteger(ticketId)) return false;
    const [ticket] = await db.select({ vendorId: ticketsTable.vendorId, partnerId: siteLocationsTable.partnerId })
      .from(ticketsTable).innerJoin(siteLocationsTable, eq(siteLocationsTable.id, ticketsTable.siteLocationId))
      .where(eq(ticketsTable.id, ticketId)).limit(1);
    return Boolean(ticket && ((session.vendorId && session.vendorId === ticket.vendorId) || (session.partnerId && session.partnerId === ticket.partnerId)));
  }
  if (channel.contextKind === "site") {
    const siteId = Number(channel.contextId);
    const [site] = await db.select({ partnerId: siteLocationsTable.partnerId }).from(siteLocationsTable).where(eq(siteLocationsTable.id, siteId)).limit(1);
    return Boolean(site && session.partnerId === site.partnerId);
  }
  return false;
}

export async function resolveChannelAccess(
  session: SessionPayload & { userId: number }, channelId: string, capability: WorkHubCapability,
): Promise<{ channel: typeof workHubChannelsTable.$inferSelect; access: WorkHubAccess }> {
  const [channel] = await db.select().from(workHubChannelsTable).where(eq(workHubChannelsTable.id, channelId)).limit(1);
  if (!channel || channel.status !== "active") throw new (await import("./context-access")).WorkHubAccessError("not_found");
  if (await collaborationChannelAccess(session.userId, channel.id) === false) throw new (await import("./context-access")).WorkHubAccessError("not_found");
  const access = createWorkHubAccess({
    session, owner: { type: channel.ownerOrgType as "vendor" | "partner", id: channel.ownerOrgId },
    context: { kind: channel.contextKind as "organization" | "ticket" | "site" | "crew" | "gate" | "chat", id: channel.contextId },
    participant: await isWorkHubParticipant(session, channel), visibilityRevision: `${session.userId}:${channel.updatedAt.toISOString()}`,
  });
  const scope = await collaborationChannelScope(session.userId, channel.id);
  const resolved = scope ? { ...access, capabilities: new Set<WorkHubCapability>(scope.manager ? ["channel.read", "channel.write", "file.download", "channel.manage", "task.assign", "announcement.publish", "meeting.host"] : ["channel.read", "channel.write", "file.download"]) } : access;
  requireWorkHubCapability(resolved, capability);
  return { channel, access: resolved };
}

export async function listOwnedWorkHubChannels(session: SessionPayload & { userId: number }, before?: Date, limit = 50) {
  const requested = Math.min(100, Math.max(1, limit));
  const visible: (typeof workHubChannelsTable.$inferSelect)[] = [];
  let cursor: { updatedAt: Date; id: string } | undefined;
  // Keep scanning until the authorized page is full. A tenant with older channels
  // must not disappear behind another company's newer channels.
  while (visible.length < requested) {
    const candidates = await db.select().from(workHubChannelsTable)
      .where(and(eq(workHubChannelsTable.status, "active"), before ? lt(workHubChannelsTable.updatedAt, before) : undefined,
        cursor ? or(lt(workHubChannelsTable.updatedAt, cursor.updatedAt), and(eq(workHubChannelsTable.updatedAt, cursor.updatedAt), lt(workHubChannelsTable.id, cursor.id))) : undefined))
      .orderBy(desc(workHubChannelsTable.updatedAt), desc(workHubChannelsTable.id)).limit(200);
    const accessible = await Promise.all(candidates.map(async channel => ({ channel, allowed: await isWorkHubParticipant(session, channel) })));
    visible.push(...accessible.filter(entry => entry.allowed).map(entry => entry.channel));
    if (candidates.length < 200) break;
    const last = candidates[candidates.length - 1]!;
    cursor = { updatedAt: last.updatedAt, id: last.id };
  }
  return visible.slice(0, requested);
}
