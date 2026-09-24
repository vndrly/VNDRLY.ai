import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, usersTable, userOrgMembershipsTable, workHubChatInvitationsTable, workHubCollaborationChannelsTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { WorkHubAccessError } from "./context-access";

/** Shared private-call boundary: current coworker or accepted two-party chat.
 * A call's meeting belongs to its initiator; it is not recipient authority.
 */
export async function authorizeCallContact(a: SessionPayload & { userId: number }, recipientUserId: number) {
  if (a.userId === recipientUserId) throw new WorkHubAccessError("forbidden");
  const orgType = a.vendorId ? "vendor" : "partner",
    orgId = a.vendorId ?? a.partnerId;
  if (!orgId) throw new WorkHubAccessError("forbidden");
  const memberships = await db.select().from(userOrgMembershipsTable).where(and(
    inArray(userOrgMembershipsTable.userId, [a.userId, recipientUserId]),
    eq(userOrgMembershipsTable.orgType, orgType),
    orgType === "vendor" ? eq(userOrgMembershipsTable.vendorId, orgId) : eq(userOrgMembershipsTable.partnerId, orgId),
  ));
  if (!memberships.some(m => m.userId === a.userId)) throw new WorkHubAccessError("forbidden");
  if (!memberships.some(m => m.userId === recipientUserId)) {
    const [accepted] = await db.select().from(workHubChatInvitationsTable)
      .innerJoin(workHubCollaborationChannelsTable, eq(workHubCollaborationChannelsTable.channelId, workHubChatInvitationsTable.channelId))
      .where(and(
        eq(workHubChatInvitationsTable.status, "accepted"), eq(workHubCollaborationChannelsTable.kind, "chat"),
        or(
          and(eq(workHubChatInvitationsTable.senderUserId, a.userId), eq(workHubChatInvitationsTable.recipientUserId, recipientUserId)),
          and(eq(workHubChatInvitationsTable.senderUserId, recipientUserId), eq(workHubChatInvitationsTable.recipientUserId, a.userId)),
        ),
      )).limit(1);
    if (!accepted) throw new WorkHubAccessError("forbidden");
  }
  const [recipient] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, recipientUserId), isNull(usersTable.suspendedAt))).limit(1);
  if (!recipient) throw new WorkHubAccessError("not_found");
  return { owner: { type: orgType as "vendor" | "partner", id: orgId }, recipient };
}
