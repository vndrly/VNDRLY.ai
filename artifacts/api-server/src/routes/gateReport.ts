import { Router } from "express";
import { getSessionFromRequest } from "../lib/session";
import { GateReportError, getGateReport } from "../lib/gate-report";
import { enforceVisitsRateLimit } from "../lib/visits-rate-limit";

const router = Router();
router.get("/gate-report", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) { res.status(401).json({ code: "auth.required", message: "Login required" }); return; }
  if (!(await enforceVisitsRateLimit(req, res, { ...session, userId: session.userId }))) return;
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await getGateReport(session, req.query));
  } catch (error) {
    if (error instanceof GateReportError) { res.status(error.status).json({ code: error.code, message: error.message }); return; }
    throw error;
  }
});
export default router;
