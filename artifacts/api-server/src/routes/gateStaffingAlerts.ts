import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { getSessionFromRequest } from "../lib/session";
import { ChangeOverError } from "../services/gate-change-over";
import {
  acknowledgeGateStaffingAlert,
  listGateStaffingAlerts,
} from "../services/gate-staffing-alerts";

const router = Router();
router.get("/gate-staffing-alerts", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res
      .status(401)
      .json({ error: "Sign in required", code: "auth.unauthenticated" });
    return;
  }
  res.json(await listGateStaffingAlerts(session));
});
router.post("/gate-staffing-alerts/:id/acknowledge", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res
      .status(401)
      .json({ error: "Sign in required", code: "auth.unauthenticated" });
    return;
  }
  const id = z.string().uuid().parse(req.params.id);
  const input = z
    .object({ channel: z.enum(["web", "ios", "push"]).optional() })
    .strict()
    .parse(req.body ?? {});
  res.json({
    alert: await acknowledgeGateStaffingAlert(
      session,
      id,
      input.channel ?? "web",
    ),
  });
});
const errors: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof ChangeOverError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    res
      .status(400)
      .json({
        error: "Invalid staffing alert request",
        code: "staffing_alert.invalid_request",
      });
    return;
  }
  next(error);
};
router.use(errors);
export default router;
