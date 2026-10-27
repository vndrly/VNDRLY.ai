import { Router } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { GateTaskError, gateTaskOptions, mutateGateTask, readGateTaskHopper } from "../services/gate-task-hopper";
import { WorkdayError } from "../services/workday";
import { notifyUsers } from "./notifications";

const router = Router();
const filter = z.object({ stationId: z.uuid().optional(), taskId: z.uuid().optional(), before: z.uuid().optional() }).strict();
const command = z.object({ operationId: z.uuid(), action: z.enum(["create", "import", "complete", "assign", "clear", "delete"]),
  taskId: z.uuid().optional(), expectedVersion: z.number().int().positive().optional(), vendorId: z.number().int().positive().optional(), stationId: z.uuid().optional(),
  text: z.string().trim().min(1).max(2000).optional(), note: z.string().trim().min(1).max(2000).optional(), assigneeUserId: z.number().int().positive().nullable().optional(),
}).strict().refine(value => value.action === "create" ? Boolean(value.stationId && value.text) : value.action === "import" ? Boolean(value.stationId && value.taskId) : Boolean(value.taskId && value.expectedVersion), "Task identity and current version are required");
router.use("/work-hub/gate-task-hopper", async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!await isWorkHubEnabled()) return sendApiError(res, 404, "work_hub.not_found", "Not found");
  if (!getSessionFromRequest(req)?.userId) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
  next();
});
function failure(res: Parameters<typeof sendApiError>[0], error: unknown) {
  if (error instanceof z.ZodError) return sendApiError(res, 400, "gate_task.invalid", "Check task details and try again");
  if (error instanceof GateTaskError) return sendApiError(res, error.status, "gate_task.rejected", error.message);
  if (error instanceof WorkdayError) return sendApiError(res, error.status, error.code, error.code === "gate_task.on_shift_required" ? "Start your shift before completing hopper tasks" : "Your current shift could not be verified");
  console.error("Gate task hopper request failed", error instanceof Error ? error.name : "Unknown error");
  return sendApiError(res, 500, "gate_task.unavailable", "Task records could not be verified");
}
router.get("/work-hub/gate-task-hopper/options", async (req, res) => {
  try { const input = z.object({ taskId: z.uuid().optional() }).strict().parse(req.query); res.json(await gateTaskOptions(getSessionFromRequest(req)!, input.taskId)); } catch (error) { failure(res, error); }
});
router.get("/work-hub/gate-task-hopper", async (req, res) => {
  try { res.json(await readGateTaskHopper(getSessionFromRequest(req)!, filter.parse(req.query))); } catch (error) { failure(res, error); }
});
router.post("/work-hub/gate-task-hopper", async (req, res) => {
  try {
    const input = command.parse(req.body), result = await mutateGateTask(getSessionFromRequest(req)!, input);
    if (input.action === "assign" && result.task.assigneeUserId && !result.replayed) await notifyUsers([result.task.assigneeUserId], {
      type: "work_hub_task_assigned", category: "work_hub_tasks", title: "Gate task assigned", body: result.task.title,
      link: `/work-hub/tasks?task=${result.task.id}`, dedupeKey: `gate-task:${input.operationId}:assigned`,
    }).catch(() => console.warn("Gate task assignment notification delivery pending"));
    res.json(result);
  } catch (error) { failure(res, error); }
});
export default router;
