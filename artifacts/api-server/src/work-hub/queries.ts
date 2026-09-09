import { and, desc, eq, lt } from "drizzle-orm";
import { db, siteLocationsTable, ticketsTable, workHubChannelMembersTable, workHubChannelsTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { createWorkHubAccess, requireWorkHubCapability, type WorkHubAccess } from "./context-access";
import type { WorkHubCapability } from "@workspace/api-zod";

export async function isWorkHubParticipant(session: SessionPayload & { userId: number }, channel: typeof workHubChannelsTable.$inferSelect): Promise<boolean> {
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
  const access = createWorkHubAccess({
    session, owner: { type: channel.ownerOrgType as "vendor" | "partner", id: channel.ownerOrgId },
    context: { kind: channel.contextKind as "organization" | "ticket" | "site" | "crew" | "gate", id: channel.contextId },
    participant: await isWorkHubParticipant(session, channel), visibilityRevision: `${session.userId}:${channel.updatedAt.toISOString()}`,
  });
  requireWorkHubCapability(access, capability);
  return { channel, access };
}

export async function listOwnedWorkHubChannels(session: SessionPayload & { userId: number }, before?: Date, limit = 50) {
  const requested = Math.min(100, Math.max(1, limit));
  const candidates = await db.select().from(workHubChannelsTable)
    .where(and(eq(workHubChannelsTable.status, "active"), before ? lt(workHubChannelsTable.updatedAt, before) : undefined))
    .orderBy(desc(workHubChannelsTable.updatedAt), desc(workHubChannelsTable.id))
    .limit(session.role === "admin" ? requested : Math.max(requested * 4, 200));
  if (session.role === "admin") return candidates;
  const accessible = await Promise.all(candidates.map(async (channel) => ({ channel, allowed: await isWorkHubParticipant(session, channel) })));
  return accessible.filter((entry) => entry.allowed).slice(0, requested).map((entry) => entry.channel);
}
