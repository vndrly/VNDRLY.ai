import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { workdayService, WorkdayError } from "../services/workday";
const router = Router();
function endpoint(
  action: (session: SessionPayload, req: Request) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const session = getSessionFromRequest(req);
    if (!session?.userId)
      return res.status(401).json({ code: "auth.unauthenticated" });
    try {
      return res.json(await action(session, req));
    } catch (error) {
      if (error instanceof WorkdayError)
        return res.status(error.status).json({ code: error.code });
      if (error instanceof z.ZodError)
        return res.status(400).json({ code: "workday.invalid_request" });
      req.log?.error({ err: error }, "Workday request failed");
      return res.status(500).json({ code: "workday.internal_error" });
    }
  };
}
router.get(
  "/work-hub/workday/dashboard-hours",
  endpoint((session, req) => workdayService.dashboardHours(session, req.query)),
);
router.get(
  "/work-hub/workday",
  endpoint((session) => workdayService.current(session)),
);
router.post("/work-hub/workday/reauthorize",endpoint((session,req)=>workdayService.reauthorize(session,req.body)));
router.post("/work-hub/workday/assistant-events",endpoint((session,req)=>workdayService.recordAssistant(session,req.body)));
router.post(
  "/work-hub/workday/events",
  endpoint((session, req) => workdayService.record(session, req.body)),
);
router.post("/work-hub/workday/shifts/:id/adjustments",endpoint((session,req)=>workdayService.adjust(session,z.uuid().parse(req.params.id),req.body)));
router.get(
  "/work-hub/workday/operations/:operationId",
  endpoint((session, req) =>
    workdayService.operation(session, z.uuid().parse(req.params.operationId)),
  ),
);
router.get(
  "/work-hub/workday/shifts/:id",
  endpoint((session, req) =>
    workdayService.read(session, z.uuid().parse(req.params.id)),
  ),
);
router.get(
  "/work-hub/workday/workers/:workerUserId/calendar-context",
  endpoint((session, req) => workdayService.employeeCalendarContext(session, z.coerce.number().int().positive().parse(req.params.workerUserId))),
);
router.get(
  "/work-hub/workday/workers/:workerUserId",
  endpoint((session, req) =>
    workdayService.list(
      session,
      z.coerce.number().int().positive().parse(req.params.workerUserId),
      req.query,
    ),
  ),
);
export default router;
