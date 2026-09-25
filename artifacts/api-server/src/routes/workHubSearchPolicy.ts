import { and, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { assetsTable } from "@workspace/db";

type ChannelOwner = { ownerOrgType: string; ownerOrgId: number };
type Membership = { orgType: string; vendorId: number | null; partnerId: number | null; role: string };
type ChannelSession = { role?: string; vendorId?: number | null; partnerId?: number | null; membershipRole?: string | null; managedSubcontractor?: { siteGrants: unknown[] } };

/** Derive channel access from current membership, never a stale active-owner cookie. */
export function channelSearchContext<T extends ChannelSession>(
  session: T,
  channel: ChannelOwner,
  memberships: readonly Membership[],
  currentlySponsored: boolean,
  currentSharedInvitation: boolean,
): T | null {
  if (session.role === "admin") return session;
  const membership = memberships.find(row => row.orgType === channel.ownerOrgType &&
    (row.orgType === "vendor" ? row.vendorId : row.partnerId) === channel.ownerOrgId);
  if (membership) return {
    ...session,
    vendorId: membership.orgType === "vendor" ? channel.ownerOrgId : null,
    partnerId: membership.orgType === "partner" ? channel.ownerOrgId : null,
    membershipRole: membership.role,
    managedSubcontractor: undefined,
  };
  if (channel.ownerOrgType === "vendor" && currentlySponsored && session.vendorId === channel.ownerOrgId) return session;
  if (!currentSharedInvitation) return null;
  return session.managedSubcontractor ? { ...session, managedSubcontractor: undefined } : session;
}

const AssetCursorSchema = z.object({
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.uuid(),
});
export type AssetCursor = z.infer<typeof AssetCursorSchema>;
export function encodeAssetCursor(value: AssetCursor): string {
  return Buffer.from(JSON.stringify(AssetCursorSchema.parse(value))).toString("base64url");
}
export function decodeAssetCursor(token: string): AssetCursor {
  return AssetCursorSchema.parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
}
export function assetCursorCondition(value: AssetCursor) {
  return or(
    sql`${assetsTable.updatedAt} < ${value.updatedAt}::timestamptz`,
    and(sql`${assetsTable.updatedAt} = ${value.updatedAt}::timestamptz`, lt(assetsTable.id, value.id)),
  )!;
}

const sourceLimits: Record<string, number> = {
  task: 200, meeting: 200, file: 200, announcement: 200,
  message: 300, note: 200, form: 200, transcript: 500, asset: 200,
};
const channelDependents = new Set(["message", "note", "file", "announcement", "channel"]);
export function searchCappedSources(input: {
  types: string[];
  channelCount: number;
  sourceCounts: Record<string, number>;
  combinedCount: number;
  assetOnly?: boolean;
}): string[] {
  const wants = (type: string) => input.types.length === 0 || input.types.includes(type);
  const capped = Object.entries(sourceLimits)
    .filter(([type, limit]) => (wants(type) || type === "transcript" && wants("meeting")) &&
      (input.sourceCounts[type] ?? 0) >= (type === "asset" && input.assetOnly ? 101 : limit))
    .map(([type]) => type);
  if (input.channelCount >= 500 && (input.types.length === 0 || input.types.some(type => channelDependents.has(type)))) capped.push("channel");
  if (input.combinedCount > 100) capped.push("combined");
  return capped;
}
