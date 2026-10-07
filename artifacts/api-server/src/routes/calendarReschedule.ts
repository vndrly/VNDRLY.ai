import { Router } from "express";
import { ZodError } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { calendarRescheduleForSession } from "../services/calendar-reschedule-repository";
const router = Router();
router.get("/work-hub/calendar-reschedule/:occurrenceId/snapshot", async (req,res) => {
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }
  try { res.json(await calendarRescheduleForSession(session).inspect(req.params.occurrenceId)); }
  catch (error) { res.status(error instanceof ZodError ? 400 : 403).json({ error: "Calendar snapshot unavailable" }); }
});
for (const action of ["execute", "readback"] as const) router.post(`/work-hub/calendar-reschedule/${action}`, async (req,res) => {
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }
  try { res.json(await calendarRescheduleForSession(session)[action](req.body)); }
  catch (error) { const message = error instanceof Error ? error.message : ""; res.status(error instanceof ZodError ? 400 : message === "calendar.snapshot_conflict" || message === "calendar.operation_conflict" || message === "calendar.terminal_occurrence" ? 409 : 403).json({ error: "Calendar reschedule unavailable" }); }
});
export default router;
