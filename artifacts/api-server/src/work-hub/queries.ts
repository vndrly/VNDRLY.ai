import { and, desc, eq, getTableColumns, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { db, siteWorkAssignmentsTable, siteLocationsTable, ticketsTable, workHubChannelMembersTable, workHubChannelsTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { managedWorkerSiteRole } from "../lib/managed-worker-access";
import { createWorkHubAccess, requireWorkHubCapability, type WorkHubAccess } from "./context-access";
import type { WorkHubCapability } from "@workspace/api-zod";
import { collaborationChannelAccess, collaborationChannelScope } from "./collaboration-access";

export async function isWorkHubParticipant(session: SessionPayload & { userId: number }, channel: typeof workHubChannelsTable.$inferSelect): Promise<boolean> {
  if (session.managedSubcontractor) {
    if (channel.ownerOrgType !== "vendor" || channel.ownerOrgId !== session.vendorId) return false;
    if (channel.contextKind === "site" || channel.contextKind === "gate") {
      if (!managedWorkerSiteRole(session, Number(channel.contextId))) return false;
      const [assignment] = await db.select({ id: siteWorkAssignmentsTable.id }).from(siteWorkAssignmentsTable)
        .where(and(eq(siteWorkAssignmentsTable.vendorId, channel.ownerOrgId), eq(siteWorkAssignmentsTable.siteLocationId, Number(channel.contextId)))).limit(1);
      if (!assignment) return false;
    }
    const collaboration = await collaborationChannelAccess(session.userId, channel.id);
    if (collaboration !== null) return collaboration;
    const [member] = await db.select({ id: workHubChannelMembersTable.id }).from(workHubChannelMembersTable)
      .where(and(eq(workHubChannelMembersTable.channelId, channel.id), eq(workHubChannelMembersTable.userId, session.userId))).limit(1);
    if (member) return true;
    return channel.visibility === "organization" && (channel.contextKind === "organization" || channel.contextKind === "site" || channel.contextKind === "gate");
  }
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
  const participant = await isWorkHubParticipant(session, channel);
  if (!participant) throw new (await import("./context-access")).WorkHubAccessError("not_found");
  const access = createWorkHubAccess({
    session, owner: { type: channel.ownerOrgType as "vendor" | "partner", id: channel.ownerOrgId },
    context: { kind: channel.contextKind as "organization" | "ticket" | "site" | "crew" | "gate" | "chat", id: channel.contextId },
    participant, visibilityRevision: `${session.userId}:${channel.updatedAt.toISOString()}`,
  });
  const scope = await collaborationChannelScope(session.userId, channel.id);
  const resolved = scope && !session.managedSubcontractor ? { ...access, capabilities: new Set<WorkHubCapability>(scope.manager ? ["channel.read", "channel.write", "file.download", "file.upload", "note.create", "note.edit", "channel.manage", "task.assign", "announcement.publish", "meeting.host"] : ["channel.read", "channel.write", "file.download", "file.upload", "note.create", "note.edit"]) } : access;
  requireWorkHubCapability(resolved, capability);
  return { channel, access: resolved };
}

function listedChannelAccess(session: SessionPayload & { userId: number }): SQL | undefined {
  const ownerMatch = session.vendorId
    ? sql`(${workHubChannelsTable.ownerOrgType} = 'vendor' AND ${workHubChannelsTable.ownerOrgId} = ${session.vendorId})`
    : session.partnerId
      ? sql`(${workHubChannelsTable.ownerOrgType} = 'partner' AND ${workHubChannelsTable.ownerOrgId} = ${session.partnerId})`
      : sql`false`;
  const legacyAccess = sql`(
    NOT EXISTS (SELECT 1 FROM work_hub_collaboration_channels collaboration WHERE collaboration.channel_id = ${workHubChannelsTable.id})
    AND (
      ${session.role === "admin"}
      OR EXISTS (SELECT 1 FROM work_hub_channel_members member WHERE member.channel_id = ${workHubChannelsTable.id} AND member.user_id = ${session.userId})
      OR (${ownerMatch} AND (${session.membershipRole === "admin"} OR ${workHubChannelsTable.visibility} = 'organization'))
      OR (${workHubChannelsTable.contextKind} = 'ticket' AND EXISTS (
        SELECT 1 FROM tickets ticket
        JOIN site_locations site ON site.id = ticket.site_location_id
        WHERE ticket.id::text = ${workHubChannelsTable.contextId}
          AND (ticket.vendor_id = ${session.vendorId ?? -1} OR site.partner_id = ${session.partnerId ?? -1})
      ))
      OR (${workHubChannelsTable.contextKind} = 'site' AND EXISTS (
        SELECT 1 FROM site_locations site
        WHERE site.id::text = ${workHubChannelsTable.contextId} AND site.partner_id = ${session.partnerId ?? -1}
      ))
    )
  )`;
  const collaborationAccess = sql`EXISTS (
    SELECT 1 FROM work_hub_collaboration_channels collaboration
    WHERE collaboration.channel_id = ${workHubChannelsTable.id}
      AND (
        collaboration.crew_id IS NULL
        OR collaboration.kind = 'shared'
        OR EXISTS (
          SELECT 1 FROM work_hub_crews crew
          JOIN user_org_memberships membership
            ON membership.user_id = ${session.userId}
           AND membership.org_type = crew.owner_org_type
           AND ((crew.owner_org_type = 'vendor' AND membership.vendor_id = crew.owner_org_id)
             OR (crew.owner_org_type = 'partner' AND membership.partner_id = crew.owner_org_id))
          WHERE crew.id = collaboration.crew_id
        )
      )
      AND (
        EXISTS (SELECT 1 FROM work_hub_channel_members member WHERE member.channel_id = ${workHubChannelsTable.id} AND member.user_id = ${session.userId})
        OR (collaboration.kind = 'crew' AND EXISTS (
          SELECT 1 FROM work_hub_crew_members crew_member
          WHERE crew_member.crew_id = collaboration.crew_id AND crew_member.user_id = ${session.userId}
        ))
      )
  )`;
  return sql`(${legacyAccess} OR ${collaborationAccess})`;
}

const ChannelCursorSchema = z.object({ updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/), id: z.uuid() });
type ChannelCursor = z.infer<typeof ChannelCursorSchema>;
export function decodeChannelCursor(token: string): ChannelCursor {
  if (token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid channel cursor");
  return ChannelCursorSchema.parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
}

export async function listOwnedWorkHubChannels(session: SessionPayload & { userId: number }, before?: Date | ChannelCursor, limit = 50, beforeId?: string) {
  const requested = Math.min(100, Math.max(1, limit));
  const page = (cursorAt?: string, cursorId?: string) => db.select({
    ...getTableColumns(workHubChannelsTable),
    cursorUpdatedAt: sql<string>`to_char(${workHubChannelsTable.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }).from(workHubChannelsTable)
    .where(and(
      eq(workHubChannelsTable.status, "active"),
      cursorAt ? cursorId
        ? or(sql`${workHubChannelsTable.updatedAt} < ${cursorAt}::timestamptz`, and(sql`${workHubChannelsTable.updatedAt} = ${cursorAt}::timestamptz`, lt(workHubChannelsTable.id, cursorId)))
        : sql`${workHubChannelsTable.updatedAt} < ${cursorAt}::timestamptz` : undefined,
      listedChannelAccess(session),
    ))
    .orderBy(desc(workHubChannelsTable.updatedAt), desc(workHubChannelsTable.id))
    .limit(requested);
  let rows = await page(before instanceof Date ? before.toISOString() : before?.updatedAt, before instanceof Date ? beforeId : before?.id ?? beforeId);
  const withCursors = (values: typeof rows) => values.map(({ cursorUpdatedAt, ...channel }) => ({
    ...channel, continuationCursor: Buffer.from(JSON.stringify({ updatedAt: cursorUpdatedAt, id: channel.id })).toString("base64url"),
  }));
  if (!session.managedSubcontractor) return withCursors(rows);
  const visible: typeof rows = [];
  while (rows.length) {
    const allowed = await Promise.all(rows.map((channel) => isWorkHubParticipant(session, channel)));
    visible.push(...rows.filter((_, index) => allowed[index]).slice(0, requested - visible.length));
    if (visible.length === requested || rows.length < requested) break;
    const last = rows[rows.length - 1]!;
    rows = await page(last.cursorUpdatedAt, last.id);
  }
  return withCursors(visible);
}
