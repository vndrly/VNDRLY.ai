import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vendorsTable, vendorCatalogVersionsTable } from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { resolveEulaDisplayText } from "@workspace/platform-eula";
import { canReadVendorAgreement, projectVendorAgreement } from "../lib/vendor-agreement";

const router: IRouter = Router();

// Historical immutable versions remain available within company boundaries.
// Live services and pricing use the partner-owned work-type endpoints.
router.get("/vendors/:vendorId/catalog/current", async (req, res): Promise<void> => {
  const vendorId = Number(req.params.vendorId);
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    res.status(400).json({ error: "Invalid vendor id" }); return;
  }
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: "Authentication required", code: "auth.required" }); return; }
  if (!await canReadVendorAgreement(session, vendorId)) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" }); return;
  }
  const [vendor] = await db.select({ currentCatalogVersionId: vendorsTable.currentCatalogVersionId })
    .from(vendorsTable).where(eq(vendorsTable.id, vendorId)).limit(1);
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  if (!vendor.currentCatalogVersionId) { res.json({ version: null }); return; }
  const [version] = await db.select().from(vendorCatalogVersionsTable)
    .where(eq(vendorCatalogVersionsTable.id, vendor.currentCatalogVersionId)).limit(1);
  if (!version || version.vendorId !== vendorId) { res.json({ version: null }); return; }
  const projected = await projectVendorAgreement(version, session);
  res.json({ version: { ...projected, eulaText: resolveEulaDisplayText(projected.eulaText) } });
});

router.get("/vendor-catalog-versions/:versionId", async (req, res): Promise<void> => {
  const versionId = Number(req.params.versionId);
  if (!Number.isInteger(versionId) || versionId <= 0) {
    res.status(400).json({ error: "Invalid version id" }); return;
  }
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: "Authentication required", code: "auth.required" }); return; }
  const [version] = await db.select().from(vendorCatalogVersionsTable)
    .where(eq(vendorCatalogVersionsTable.id, versionId)).limit(1);
  if (!version) { res.status(404).json({ error: "Catalog version not found" }); return; }
  if (!await canReadVendorAgreement(session, version.vendorId)) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" }); return;
  }
  const projected = await projectVendorAgreement(version, session);
  res.json({ ...projected, eulaText: resolveEulaDisplayText(projected.eulaText) });
});

router.all("/vendors/:vendorId/catalog/publish", (_req, res): void => {
  res.status(410).json({ error: "Services and pricing are saved per partner", code: "vendor_catalog.partner_owned" });
});
router.get("/vendors/:vendorId/catalog/publish-impact", (_req, res): void => {
  res.status(410).json({ error: "Services and pricing are saved per partner", code: "vendor_catalog.partner_owned" });
});
export default router;
