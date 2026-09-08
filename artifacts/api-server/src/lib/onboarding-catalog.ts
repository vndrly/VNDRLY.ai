import { inArray } from "drizzle-orm";
import { db, vendorWorkTypesTable, workTypesTable } from "@workspace/db";
import type { SessionPayload } from "./session";
import { vendorCatalogPartnerIds } from "./partner-catalog-access";

export async function onboardingCatalogSelection(
  session: SessionPayload, vendorId: number, ids: number[],
): Promise<number[] | null> {
  const partnerIds = await vendorCatalogPartnerIds(session, vendorId);
  if (partnerIds === null) return null;
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const rows = await db.select({ id: workTypesTable.id, partnerId: workTypesTable.partnerId })
    .from(workTypesTable).where(inArray(workTypesTable.id, uniqueIds));
  if (rows.length !== uniqueIds.length || rows.some(row => row.partnerId !== null && !partnerIds.includes(row.partnerId))) return null;
  // Master services remain signup interests in the onboarding payload. Only
  // approved partner-owned services may create current vendor catalog rows.
  return rows.filter(row => row.partnerId !== null).map(row => row.id);
}

export async function addOnboardingCatalogSelections(
  tx: Pick<typeof db, "insert">, vendorId: number, ids: number[],
): Promise<void> {
  if (!ids.length) return;
  await tx.insert(vendorWorkTypesTable).values(ids.map(workTypeId => ({ vendorId, workTypeId })))
    .onConflictDoNothing();
}
