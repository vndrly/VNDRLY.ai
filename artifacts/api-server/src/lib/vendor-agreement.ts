import { and, eq, sql } from "drizzle-orm";
import { db, vendorsTable, vendorCatalogVersionsTable, partnerVendorRelationshipsTable, workTypesTable, type VendorCatalogVersion } from "@workspace/db";
import { PLATFORM_EULA_TEXT } from "@workspace/platform-eula";
import { sha256Hex } from "./hash";
import type { SessionPayload } from "./session";
import { missingVendorApprovalFields } from "./vendor-approval-readiness";

export async function getVendorApprovalMissingFields(vendorId: number): Promise<string[]> {
  const [vendor] = await db.select({ federalTaxId: vendorsTable.federalTaxId,
    coiDocumentUrl: vendorsTable.coiDocumentUrl, insuranceExpirationDate: vendorsTable.insuranceExpirationDate })
    .from(vendorsTable).where(eq(vendorsTable.id, vendorId)).limit(1);
  return vendor ? missingVendorApprovalFields(vendor) : ["vendor"];
}

export async function ensureVendorAgreement(vendorId: number): Promise<number> {
  return db.transaction(async tx => {
    const [vendor] = await tx.select().from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId)).for("update");
    if (!vendor) throw new Error("Vendor not found");
    if (missingVendorApprovalFields(vendor).length) throw new Error("Vendor approval compliance is incomplete");
    if (vendor.currentCatalogVersionId) return vendor.currentCatalogVersionId;
    const [latest] = await tx.select({ version: sql<number>`coalesce(max(${vendorCatalogVersionsTable.version}), 0)::int` })
      .from(vendorCatalogVersionsTable).where(eq(vendorCatalogVersionsTable.vendorId, vendorId));
    const [agreement] = await tx.insert(vendorCatalogVersionsTable).values({
      vendorId, version: (latest?.version ?? 0) + 1,
      changeSummary: "Platform agreement for partner-owned services",
      eulaText: PLATFORM_EULA_TEXT, eulaHash: sha256Hex(PLATFORM_EULA_TEXT),
      workTypesSnapshot: [],
      ratesSnapshot: { dailyOtHours: null, weeklyOtHours: null, overtimeMultiplier: null },
      complianceSnapshot: { coi: null, wc: null, gl: null, autoLiability: null, w9DocumentUrl: null },
    }).returning({ id: vendorCatalogVersionsTable.id });
    await tx.update(vendorsTable).set({ currentCatalogVersionId: agreement.id }).where(eq(vendorsTable.id, vendorId));
    return agreement.id;
  });
}

export async function canReadVendorAgreement(session: SessionPayload, vendorId: number): Promise<boolean> {
  if (session.role === "admin" || (session.role === "vendor" && session.vendorId === vendorId)) return true;
  if (session.role !== "partner" || !session.partnerId) return false;
  const [rel] = await db.select({ id: partnerVendorRelationshipsTable.id }).from(partnerVendorRelationshipsTable)
    .where(and(eq(partnerVendorRelationshipsTable.partnerId, session.partnerId), eq(partnerVendorRelationshipsTable.vendorId, vendorId))).limit(1);
  return !!rel;
}

export async function projectVendorAgreement(version: VendorCatalogVersion, session: SessionPayload): Promise<VendorCatalogVersion> {
  if (session.role !== "partner") return version;
  const owned = await db.select({ id: workTypesTable.id, sourceId: workTypesTable.sourceWorkTypeId })
    .from(workTypesTable).where(eq(workTypesTable.partnerId, session.partnerId!));
  const ids = new Set(owned.flatMap(row => row.sourceId === null ? [row.id] : [row.id, row.sourceId]));
  return { ...version,
    changeSummary: null,
    publishedByUserId: null,
    ratesSnapshot: { dailyOtHours: null, weeklyOtHours: null, overtimeMultiplier: null },
    workTypesSnapshot: version.workTypesSnapshot.filter(row => ids.has(row.workTypeId)),
  };
}
