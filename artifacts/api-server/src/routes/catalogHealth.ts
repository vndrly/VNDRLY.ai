import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  workTypesTable,
  vendorWorkTypesTable,
  vendorsTable,
  siteWorkAssignmentsTable,
  partnerVendorWorkTypeApprovalsTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/session";

const router: IRouter = Router();

router.get("/admin/catalog-health", requireAdmin, async (_req, res): Promise<void> => {
  const platformWorkTypes = await db
    .select({ id: workTypesTable.id, name: workTypesTable.name })
    .from(workTypesTable)
    .where(isNull(workTypesTable.partnerId));

  const vendorSelections = await db
    .select({
      vendorId: vendorWorkTypesTable.vendorId,
      vendorName: vendorsTable.name,
      workTypeId: vendorWorkTypesTable.workTypeId,
      unitPrice: vendorWorkTypesTable.unitPrice,
    })
    .from(vendorWorkTypesTable)
    .innerJoin(vendorsTable, eq(vendorWorkTypesTable.vendorId, vendorsTable.id));

  const swas = await db
    .select({
      siteLocationId: siteWorkAssignmentsTable.siteLocationId,
      vendorId: siteWorkAssignmentsTable.vendorId,
      workTypeId: siteWorkAssignmentsTable.workTypeId,
    })
    .from(siteWorkAssignmentsTable);

  const vendorCatalogIds = new Map<number, Set<number>>();
  const missingPrice: { vendorId: number; vendorName: string; workTypeId: number }[] =
    [];
  const vendorsWithSelections = new Set<number>();

  for (const row of vendorSelections) {
    vendorsWithSelections.add(row.vendorId);
    if (!vendorCatalogIds.has(row.vendorId)) {
      vendorCatalogIds.set(row.vendorId, new Set());
    }
    vendorCatalogIds.get(row.vendorId)!.add(row.workTypeId);
    if (!row.unitPrice) {
      missingPrice.push({
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        workTypeId: row.workTypeId,
      });
    }
  }

  const swaWithoutCatalog: {
    siteLocationId: number;
    vendorId: number;
    workTypeId: number;
  }[] = [];
  for (const swa of swas) {
    const ids = vendorCatalogIds.get(swa.vendorId);
    if (!ids || !ids.has(swa.workTypeId)) {
      swaWithoutCatalog.push(swa);
    }
  }

  const vendorsWithOffers = new Set(vendorSelections.map((r) => r.workTypeId));
  const platformWithoutVendors = platformWorkTypes.filter(
    (wt) => !vendorsWithOffers.has(wt.id),
  );

  const approvalCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(partnerVendorWorkTypeApprovalsTable);

  res.json({
    totals: {
      platformWorkTypes: platformWorkTypes.length,
      vendorSelections: vendorSelections.length,
      siteAssignments: swas.length,
      approvals: approvalCount[0]?.n ?? 0,
      vendorsWithCatalog: vendorsWithSelections.size,
    },
    issues: {
      platformWorkTypesWithoutVendors: platformWithoutVendors.slice(0, 50),
      vendorSelectionsMissingPrice: missingPrice.slice(0, 50),
      siteAssignmentsWithoutCatalogRow: swaWithoutCatalog.slice(0, 50),
    },
    issueCounts: {
      platformWorkTypesWithoutVendors: platformWithoutVendors.length,
      vendorSelectionsMissingPrice: missingPrice.length,
      siteAssignmentsWithoutCatalogRow: swaWithoutCatalog.length,
    },
  });
});

export default router;
