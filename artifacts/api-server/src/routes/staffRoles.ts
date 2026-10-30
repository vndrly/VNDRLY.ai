import { Router } from "express";
import { getSessionFromRequest } from "../lib/session";
import { isVendorOfficeStaff } from "../lib/vendor-people-management";
import { catalogInput, readStaffRoleCatalog, saveStaffRoleCatalog, StaffRoleCatalogError } from "../services/staff-role-catalog";
const router = Router();
router.use("/vendors/:vendorId/staff-roles", async (req, res, next) => {
  const vendorId = Number(req.params.vendorId), session = getSessionFromRequest(req);
  if (!session?.userId || !session.role) { res.status(401).json({ error: "Sign in to view staffing roles." }); return; }
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0) { res.status(400).json({ error: "Invalid company" }); return; }
  const office = await isVendorOfficeStaff({ ...session, role: session.role, userId: session.userId, vendorId: session.vendorId ?? null }, vendorId);
  if (!office && (req.method !== "GET" || session.vendorId !== vendorId)) { res.status(403).json({ error: "Company office or administrator access required." }); return; }
  res.locals.staffRoleVendorId = vendorId; res.locals.canEditStaffRoles = office; next();
});
router.get("/vendors/:vendorId/staff-roles", async (_req, res, next) => {
  try { res.setHeader("Cache-Control", "no-store"); res.json({ ...await readStaffRoleCatalog(res.locals.staffRoleVendorId), canEdit: res.locals.canEditStaffRoles }); }
  catch (error) { if (error instanceof StaffRoleCatalogError) res.status(error.status).json({ error: error.message }); else next(error); }
});
router.put("/vendors/:vendorId/staff-roles", async (req, res, next) => {
  const parsed = catalogInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter unique staffing role names and groups. VNDRLY operational roles cannot be changed here." }); return; }
  try { res.json({ ...await saveStaffRoleCatalog(res.locals.staffRoleVendorId, parsed.data), canEdit: true }); }
  catch (error) { if (error instanceof StaffRoleCatalogError) res.status(error.status).json({ error: error.message }); else next(error); }
});
export default router;
