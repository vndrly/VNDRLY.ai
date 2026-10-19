import { and, eq } from "drizzle-orm";
import { vendorsTable, vendorServiceAreasTable } from "@workspace/db/schema";

type Database = typeof import("@workspace/db").db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Coverage is derived from the saved base. Preserve historical areas but retire
 * every active default/override atomically with any source-address change. */
export async function updateVendorAddressAndCoverage(
  database: Pick<Database, "transaction">,
  vendorId: number,
  data: Partial<typeof vendorsTable.$inferInsert>,
) {
  return database.transaction(tx => updateVendorAddressAndCoverageInTransaction(tx, vendorId, data));
}

/** Reuse the caller's transaction so onboarding's other canonical writes and
 * coverage retirement either commit together or all roll back. */
export async function updateVendorAddressAndCoverageInTransaction(
  tx: Pick<Transaction, "select" | "update">,
  vendorId: number,
  data: Partial<typeof vendorsTable.$inferInsert>,
) {
  const [current] = await tx.select({ physicalAddress: vendorsTable.physicalAddress })
    .from(vendorsTable).where(eq(vendorsTable.id, vendorId)).for("update");
  if (!current) return [];
  const changedAddress = data.physicalAddress !== undefined && current.physicalAddress !== data.physicalAddress;
  if (changedAddress) {
    const now = new Date();
    await tx.update(vendorServiceAreasTable)
      .set({ active: false, effectiveUntil: now, updatedAt: now })
      .where(and(eq(vendorServiceAreasTable.vendorId, vendorId), eq(vendorServiceAreasTable.active, true)));
  }
  return tx.update(vendorsTable).set({ ...data,
    ...(changedAddress ? { latitude: null, longitude: null, geocodedAt: null } : {}),
  }).where(eq(vendorsTable.id, vendorId)).returning();
}
