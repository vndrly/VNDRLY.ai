import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, siteVisitsTable } from "@workspace/db";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { parseVisitEntryCategory } from "../lib/visit-entry-category";

export function visitEntryCategoryScope(session: SessionPayload) {
  if (!session.userId) return null;
  if (session.role === "admin") return sql`true`;
  if (session.role === "partner" && session.partnerId) return sql`EXISTS (
    SELECT 1 FROM site_locations s WHERE s.id = ${siteVisitsTable.siteLocationId} AND s.partner_id = ${session.partnerId}
  )`;
  if (session.role === "vendor" && session.vendorId) {
    if (session.vendorRole === "gatekeeper") return sql`EXISTS (
      SELECT 1 FROM site_work_assignments a WHERE a.site_location_id = ${siteVisitsTable.siteLocationId} AND a.vendor_id = ${session.vendorId}
    )`;
    return and(eq(siteVisitsTable.hostType, "vendor"), eq(siteVisitsTable.hostVendorId, session.vendorId));
  }
  return null;
}
const router = Router();
router.patch("/visits/:id/entry-category", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ message: "Login required" }); return; }
  const scope = visitEntryCategoryScope(session);
  if (!scope) { res.status(403).json({ message: "Authorized staff access required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !("entryCategory" in (req.body ?? {}))) { res.status(400).json({ message: "Visit and category are required" }); return; }
  let entryCategory;
  try { entryCategory = parseVisitEntryCategory(req.body.entryCategory); }
  catch { res.status(400).json({ message: "Invalid entry category" }); return; }
  // Ownership remains part of the UPDATE predicate, avoiding a read/write gap.
  const [updated] = await db.update(siteVisitsTable).set({ entryCategory })
    .where(and(eq(siteVisitsTable.id, id), scope)).returning({ id: siteVisitsTable.id, entryCategory: siteVisitsTable.entryCategory });
  if (!updated) { res.status(404).json({ message: "Visit unavailable" }); return; }
  res.json(updated);
});
export default router;
