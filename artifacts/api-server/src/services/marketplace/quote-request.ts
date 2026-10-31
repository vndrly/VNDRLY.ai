import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { MarketplaceError } from "./vendor-store";

export interface MarketplaceQuoteRequest {
  partnerId: number;
  vendorId: number;
  capabilityId: number;
  workTypeId: number;
  workTypeName: string;
  siteId: number;
  requestedCapacity: number;
  scope: string;
  now: Date;
}

/** Reuses the durable in-app inbox; a request is not a job award or a rate agreement. */
export async function notifyMarketplaceQuoteRequest(input: MarketplaceQuoteRequest): Promise<void> {
  const { db, userOrgMembershipsTable: memberships, usersTable: users, partnersTable: partners, notificationsTable: notifications } = await import("@workspace/db");
  const recipients = await db.selectDistinct({ id: memberships.userId }).from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgType, "vendor"), eq(memberships.vendorId, input.vendorId),
      inArray(memberships.role, ["admin", "member"]), isNull(users.suspendedAt)));
  if (!recipients.length) throw new MarketplaceError(409, "marketplace.vendor_contact_unavailable");
  const [partner] = await db.select({ name: partners.name }).from(partners).where(eq(partners.id, input.partnerId));
  const { notifyUsers } = await import("../../routes/notifications");
  const recipientIds = recipients.map((row) => row.id);
  const scopeHash = createHash("sha256").update(JSON.stringify([input.requestedCapacity, input.scope])).digest("hex").slice(0, 24);
  const dedupeKey = `marketplace-quote:${input.partnerId}:${input.vendorId}:${input.capabilityId}:${input.workTypeId}:${input.siteId}:${input.now.toISOString().slice(0, 10)}:${scopeHash}`;
  const inserted = await notifyUsers(recipientIds, {
    type: "marketplace_quote_request",
    title: `Quote requested: ${input.workTypeName}`,
    body: `${partner?.name ?? `Partner #${input.partnerId}`} requests a quote for ${input.workTypeName} (catalog #${input.workTypeId}), site #${input.siteId}, ${input.requestedCapacity} crew(s). ${input.scope} Open your catalog's matching partner demand to submit the rate. This request does not authorize work.`,
    link: "/vendor-catalog",
    // Retries and repeated clicks cannot create duplicate daily requests for this same demand and scope.
    dedupeKey,
  });
  if (inserted === 0) {
    const [existing] = await db.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.dedupeKey, dedupeKey), inArray(notifications.userId, recipientIds))).limit(1);
    if (!existing) throw new MarketplaceError(409, "marketplace.quote_delivery_unavailable");
  }
}
