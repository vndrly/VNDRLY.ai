import { and, eq } from "drizzle-orm";
import { db, partnerVendorRelationshipsTable } from "@workspace/db";
import type { SessionPayload } from "./session";

/** Active organization context is the authorization boundary, including users
 * with memberships in several companies. */
export async function vendorCatalogPartnerIds(
  session: SessionPayload,
  vendorId: number,
): Promise<number[] | null> {
  if (session.role !== "admin" &&
      !(session.role === "vendor" && session.vendorId === vendorId) &&
      !(session.role === "partner" && session.partnerId)) return null;
  const rows = await db.select({ partnerId: partnerVendorRelationshipsTable.partnerId })
    .from(partnerVendorRelationshipsTable)
    .where(and(
      eq(partnerVendorRelationshipsTable.vendorId, vendorId),
      eq(partnerVendorRelationshipsTable.status, "approved"),
      session.role === "partner"
        ? eq(partnerVendorRelationshipsTable.partnerId, session.partnerId!) : undefined,
    ));
  if (session.role === "partner" && rows.length === 0) return null;
  return rows.map((row) => row.partnerId);
}

export function catalogSaveScope(
  accessible: readonly { id: number; partnerId: number | null }[],
  partnerId: number | undefined,
): Set<number> {
  return new Set(accessible.filter(row => row.partnerId !== null &&
    (partnerId === undefined || row.partnerId === partnerId)).map(row => row.id));
}
