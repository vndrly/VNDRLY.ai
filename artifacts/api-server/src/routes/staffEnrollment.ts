import { Router } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { isVendorOfficeStaff } from "../lib/vendor-people-management";
import { listStaffEnrollments, sendStaffEnrollment, previewStaffEnrollment, StaffEnrollmentError } from "../services/staff-enrollment";
const router = Router();
router.use("/vendors/:vendorId/staff-enrollments", async (req, res, next) => {
  const vendorId = Number(req.params.vendorId), session = getSessionFromRequest(req);
  if (!session?.userId || !session.role) { res.status(401).json({ error: "Sign in to manage invitations." }); return; }
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0) { res.status(400).json({ error: "Invalid company" }); return; }
  if (!await isVendorOfficeStaff({ ...session, role: session.role, userId: session.userId, vendorId: session.vendorId ?? null }, vendorId)) { res.status(403).json({ error: "Company office or administrator access required." }); return; }
  res.locals.enrollmentVendorId = vendorId; res.locals.enrollmentActor = session.userId; next();
});
router.get("/vendors/:vendorId/staff-enrollments", async (_req, res) => { res.json(await listStaffEnrollments(res.locals.enrollmentVendorId)); });
router.get("/vendors/:vendorId/staff-enrollments/preview", async (req, res) => {
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src https: http://localhost:5183 http://127.0.0.1:5183; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(await previewStaffEnrollment(res.locals.enrollmentVendorId, String(req.query.name || "Your employee").slice(0, 120)));
});
router.post("/vendors/:vendorId/staff-enrollments/send", async (req, res) => {
  const parsed = z.object({ key: z.string().regex(/^(person:\d+|account:\d+|worker:[a-f0-9-]{36})$/i), email: z.email() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Select an employee and verify their email address." }); return; }
  try { res.json(await sendStaffEnrollment(res.locals.enrollmentVendorId, res.locals.enrollmentActor, parsed.data.key, parsed.data.email)); }
  catch (error) {
    const known = error instanceof StaffEnrollmentError;
    res.status(known ? error.status : 502).json({ error: known ? error.message : "The invitation could not be sent. No new login or invitation status was saved. Please retry." });
  }
});
export default router;
