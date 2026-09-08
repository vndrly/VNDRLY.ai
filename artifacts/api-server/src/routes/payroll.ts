import { Router, type IRouter } from "express";
import { and, eq, isNull, lt, or, gt, gte, sql } from "drizzle-orm";
import { db, ticketsTable, ticketCheckInsTable, vendorPeopleTable, vendorsTable } from "@workspace/db";
import { getSessionFromRequest, requireSession } from "../lib/session";
import { buildPayrollDraft, payrollBounds, payrollCsv, payrollDraftInput } from "../lib/payroll-draft";

const router: IRouter = Router();
export function mayReviewPayroll(session: { role?: string; vendorId?: number | null; vendorRole?: string | null; membershipRole?: string | null } | null, vendorId: number): boolean {
  if (!session || !Number.isSafeInteger(vendorId) || vendorId < 1) return false;
  return session.role === "admin" || (session.role === "vendor" && session.vendorId === vendorId && (session.membershipRole === "admin" || session.vendorRole === "office" || session.vendorRole === "both"));
}
router.get("/payroll/vendors/:vendorId/employees", requireSession, async (req, res) => {
  const vendorId = Number(req.params.vendorId);
  if (!mayReviewPayroll(getSessionFromRequest(req), vendorId)) { res.status(403).json({ error: "Payroll office access required" }); return; }
  const employees = await db.select({ id: vendorPeopleTable.id, firstName: vendorPeopleTable.firstName, lastName: vendorPeopleTable.lastName }).from(vendorPeopleTable).where(eq(vendorPeopleTable.vendorId, vendorId));
  res.json({ employees });
});
router.post("/payroll/vendors/:vendorId/:action", requireSession, async (req, res) => {
  const vendorId = Number(req.params.vendorId);
  if (!mayReviewPayroll(getSessionFromRequest(req), vendorId)) { res.status(403).json({ error: "Payroll office access required" }); return; }
  if (!["preview", "export"].includes(String(req.params.action))) { res.status(404).end(); return; }
  const parsed = payrollDraftInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Confirm wages and enter a valid period and overtime policy" }); return; }
  let bounds;
  try { bounds = payrollBounds(parsed.data); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid period" }); return; }
  const [vendor] = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(eq(vendorsTable.id, vendorId));
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  const sessions = await db.select({ id: ticketCheckInsTable.id, ticketId: ticketCheckInsTable.ticketId, employeeId: ticketCheckInsTable.employeeId, employeeName: sql<string>`${vendorPeopleTable.firstName} || ' ' || ${vendorPeopleTable.lastName}`, checkInAt: ticketCheckInsTable.checkInAt, checkOutAt: ticketCheckInsTable.checkOutAt })
    .from(ticketCheckInsTable).innerJoin(ticketsTable, eq(ticketsTable.id, ticketCheckInsTable.ticketId)).innerJoin(vendorPeopleTable, eq(vendorPeopleTable.id, ticketCheckInsTable.employeeId))
    .where(and(eq(ticketsTable.vendorId, vendorId), eq(vendorPeopleTable.vendorId, vendorId), lt(ticketCheckInsTable.checkInAt, new Date(bounds.end)), or(gte(ticketCheckInsTable.checkInAt, new Date(bounds.contextStart)), isNull(ticketCheckInsTable.checkOutAt), gt(ticketCheckInsTable.checkOutAt, new Date(bounds.contextStart)))))
    .orderBy(ticketCheckInsTable.checkInAt, ticketCheckInsTable.id).limit(20001);
  if (sessions.length > 20000) { res.status(422).json({ error: "Too many sessions; choose a shorter period" }); return; }
  const draft = buildPayrollDraft(parsed.data, sessions.map((row) => ({ ...row, checkInAt: row.checkInAt.toISOString(), checkOutAt: row.checkOutAt?.toISOString() ?? null })));
  res.setHeader("Cache-Control", "no-store");
  if (req.params.action === "export") {
    if (!draft.exportable || req.body.fingerprint !== draft.fingerprint) { res.status(409).json({ error: "Preview changed or has unresolved issues. Review again before exporting." }); return; }
    res.setHeader("Content-Disposition", `attachment; filename="gross-pay-${vendorId}-${parsed.data.from}.csv"`);
    res.type("text/csv").send(payrollCsv(parsed.data, draft));
    return;
  }
  res.json(draft);
});
export default router;
