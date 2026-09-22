import { Router } from "express";
import { getSessionFromRequest } from "../lib/session";
import { GateReportError, getGateReport } from "../lib/gate-report";
import { enforceVisitsRateLimit } from "../lib/visits-rate-limit";
import { z } from "zod/v4";
import {
  deliverGateReports,
  GateReportsError,
  listGateReportRecipients,
  openGateReport,
  parseGateReportFilters,
} from "../services/gate-reports";

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

router.post("/gate-report/deliver", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) { res.status(401).json({ code: "auth.required", message: "Login required" }); return; }
  try {
    const body = z.object({
      recipientUserIds: z.array(z.number().int().positive()).min(1).max(50),
      reportKind: z.enum(["history", "shift_notes"]),
      format: z.enum(["pdf", "excel", "word"]),
      filters: z.object({
        siteId: z.number().int().positive(),
        stationId: z.string().uuid().optional(),
        range: z.enum(["current_shift", "previous_shift", "24h", "7d", "14d", "30d", "90d", "1y"]),
        recordType: z.enum(["all", "check_ins", "check_outs", "visitors_on_site", "employees_on_site", "vehicles_on_site", "pending", "needs_review"]),
        search: z.string().max(200).optional(),
      }),
    }).strict().parse(req.body);
    const deliveries = await deliverGateReports({
      senderUserId: session.userId,
      ...body,
      filters: parseGateReportFilters(body.filters),
    });
    res.status(201).json({ deliveries });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ code: "gate_report.invalid_request", issues: error.issues }); return; }
    if (error instanceof GateReportsError) { res.status(error.status).json({ code: error.code }); return; }
    throw error;
  }
});

router.get("/gate-report/recipients", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) { res.status(401).json({ code: "auth.required", message: "Login required" }); return; }
  try {
    const reportKind = z.enum(["history", "shift_notes"]).parse(req.query.reportKind ?? "history");
    const filters = parseGateReportFilters(req.query as Record<string, unknown>);
    res.json({ recipients: await listGateReportRecipients({ senderUserId: session.userId, reportKind, filters }) });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ code: "gate_report.invalid_request" }); return; }
    if (error instanceof GateReportsError) { res.status(error.status).json({ code: error.code }); return; }
    throw error;
  }
});

router.get("/gate-report/secure", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId) { res.status(401).json({ code: "auth.required", message: "Login required" }); return; }
  try {
    const token = z.string().min(20).max(200).parse(req.query.token);
    const report = await openGateReport({ token, userId: session.userId });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", report.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    res.send(report.body);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ code: "gate_report.invalid_token" }); return; }
    if (error instanceof GateReportsError) { res.status(error.status).json({ code: error.code }); return; }
    throw error;
  }
});
export default router;
