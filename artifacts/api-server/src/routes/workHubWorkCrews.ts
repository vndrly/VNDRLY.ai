import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { workHubCommandEnvelopeSchema, type WorkHubOwner } from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { currentTaskAssignmentSession, canManageTaskAssignments } from "../work-hub/task-assignment";
import { WorkHubAccessError } from "../work-hub/context-access";
import { readWorkCrews, saveWorkCrew, assignWorkCrew, announceToWorkCrew } from "../work-hub/work-crews";
import { notifyUsers } from "./notifications";

const router: IRouter = Router();
router.use("/work-hub/work-crews", async (req, res, next) => {
  try {
    if (!(await isWorkHubEnabled())) return res.status(404).json({ error: "Not found" });
    const saved = getSessionFromRequest(req);
    if (!saved?.userId) return res.status(401).json({ error: "Authentication required" });
    const session = await currentTaskAssignmentSession(saved);
    if (!canManageTaskAssignments(session)) throw new WorkHubAccessError("forbidden");
    const owner: WorkHubOwner | null = session.partnerId ? { type: "partner", id: session.partnerId } : session.vendorId ? { type: "vendor", id: session.vendorId } : null;
    if (!owner) throw new WorkHubAccessError("forbidden");
    res.locals.workCrewOwner = owner;
    res.locals.workCrewActor = { userId: session.userId, source: req.header("x-vndrly-client") === "ios" ? "ios" : "web" };
    next();
  } catch (error) { next(error); }
});
function envelopeFor(body: unknown, owner: WorkHubOwner) {
  const envelope = workHubCommandEnvelopeSchema.parse(body);
  if (envelope.owner.type !== owner.type || envelope.owner.id !== owner.id) throw new WorkHubAccessError("forbidden");
  return envelope;
}
router.get("/work-hub/work-crews", async (_req, res, next) => {
  try { res.setHeader("Cache-Control", "no-store"); res.json({ ...(await readWorkCrews(res.locals.workCrewOwner)), canManage: true }); }
  catch (error) { next(error); }
});
router.post("/work-hub/work-crews", async (req, res, next) => {
  try { const result = await saveWorkCrew(res.locals.workCrewActor, envelopeFor(req.body, res.locals.workCrewOwner)); res.status(result.replayed ? 200 : 201).json(result); }
  catch (error) { next(error); }
});
router.post("/work-hub/work-crews/:id/assign", async (req, res, next) => {
  try {
    const result = await assignWorkCrew(res.locals.workCrewActor, envelopeFor(req.body, res.locals.workCrewOwner), z.uuid().parse(req.params.id));
    if (!result.replayed) await Promise.allSettled(result.resource.tasks.map(task => notifyUsers([task.assigneeUserId!], {
      type: "work_hub_task_assigned", category: "work_hub_tasks", title: "New crew assignment", body: task.title,
      link: `/work-hub/tasks?task=${task.id}`, dedupeKey: `work-hub-task:${task.id}:assigned`,
    })));
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
});
router.post("/work-hub/work-crews/:id/announcements", async (req, res, next) => {
  try {
    const result = await announceToWorkCrew(res.locals.workCrewActor, envelopeFor(req.body, res.locals.workCrewOwner), z.uuid().parse(req.params.id));
    if (!result.replayed) await Promise.allSettled([notifyUsers(result.resource.userIds, {
      type: result.resource.announcement.urgency === "urgent" ? "work_hub_announcement_urgent" : "work_hub_announcement", category: "work_hub_announcements",
      title: result.resource.announcement.title, body: result.resource.announcement.body.slice(0,180),
      link: `/work-hub?announcement=${result.resource.announcement.id}`, dedupeKey: `work-hub-announcement:${result.resource.announcement.id}`,
    })]);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
});
router.use("/work-hub/work-crews", (error: unknown, _req: unknown, res: any, _next: unknown) => {
  const known = error as { status?: number; message?: string };
  const status = error instanceof z.ZodError ? 400 : known.status ?? 500;
  res.status(status).json({ error: status === 500 ? "The work crew request could not be completed" : known.message });
});
export default router;
