import { Router } from "express";
import { db, userOrgMembershipsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
const router = Router();
const categoriesSchema = z.array(z.enum(["field", "fleet", "gate"])).min(1).max(3).refine(values => new Set(values).size === values.length);
async function access(req: any, res: any, requestedId?: number) {
  const session = getSessionFromRequest(req);
  const vendorId = requestedId ?? session?.vendorId;
  if (!session?.userId || !vendorId) { res.status(403).json({ error: "An active vendor company is required." }); return null; }
  if (session.role === "admin" && requestedId) return { vendorId, canManage: true };
  if (vendorId !== session.vendorId) { res.status(403).json({ error: "Current company membership is required." }); return null; }
  const [membership] = await db.select({ role: userOrgMembershipsTable.role }).from(userOrgMembershipsTable).where(and(eq(userOrgMembershipsTable.userId, session.userId), eq(userOrgMembershipsTable.orgType, "vendor"), eq(userOrgMembershipsTable.vendorId, vendorId), eq(userOrgMembershipsTable.id, session.activeMembershipId ?? -1)));
  if (!membership) { res.status(403).json({ error: "Current company membership is required." }); return null; }
  return { vendorId, canManage: membership.role === "admin" };
}
router.get("/company-operations", async (req, res) => {
  const requestedId = req.query.vendorId === undefined ? undefined : z.coerce.number().int().positive().safeParse(req.query.vendorId);
  if (requestedId && !requestedId.success) { res.status(400).json({ error: "Invalid company." }); return; }
  const scope = await access(req, res, requestedId?.data); if (!scope) return;
  const result = await db.execute(sql`SELECT operations_categories AS categories FROM vendors WHERE id = ${scope.vendorId}`);
  if (!result.rows.length) { res.status(404).json({ error: "Company not found." }); return; }
  res.json({ ...scope, categories: categoriesSchema.safeParse(result.rows[0]?.categories).data ?? [] });
});
router.patch("/company-operations", async (req, res) => {
  const parsed = z.object({ categories: categoriesSchema, vendorId: z.number().int().positive().optional() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Select at least one of Field Ops, Fleet Ops, and Gate Ops." }); return; }
  const scope = await access(req, res, parsed.data.vendorId); if (!scope) return;
  if (!scope.canManage) { res.status(403).json({ error: "Only the company administrator can choose its operations categories." }); return; }
  await db.execute(sql`UPDATE vendors SET operations_categories = ${"{" + parsed.data.categories.join(",") + "}"}::text[], fleet_ops_state = COALESCE(fleet_ops_state, '{"version":1,"enabled":false,"fleets":[],"grants":[],"supportGrants":[],"runs":[],"operations":[],"preferences":[]}'::jsonb) || jsonb_build_object('enabled', ${parsed.data.categories.includes("fleet")}::boolean, 'version', COALESCE((fleet_ops_state->>'version')::integer, 0) + 1) WHERE id = ${scope.vendorId}`);
  res.json({ ...scope, categories: parsed.data.categories });
});
export default router;
