import { z } from "zod/v4";
import type { PlanIdentity } from "./coordinated-plan";
const exactTask = z.object({ id: z.string().uuid(), subjectType: z.literal("task"), ownerOrgType: z.enum(["vendor", "partner"]), ownerOrgId: z.number().int().positive(), version: z.number().int().positive(), description: z.string().max(20000), status: z.enum(["open", "in_progress", "completed", "cancelled"]) });
/** request uses the existing exact-item API under the current actor. The caller must require the existing task-read scope before calling. */
export async function readExactPlanTask(request: (path: string) => Promise<unknown>, taskId: string, identity: PlanIdentity) {
  z.string().uuid().parse(taskId);
  const task = exactTask.parse(await request(`/work-hub/search/items/task/${taskId}`));
  if (task.id !== taskId || identity.organizationKey !== `${task.ownerOrgType}:${task.ownerOrgId}`) throw Error("Exact plan task identity mismatch");
  return task;
}
