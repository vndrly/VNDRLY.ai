import type { SessionPayload } from "../lib/session";
import type { WorkHubOwner } from "@workspace/api-zod";
import { canManageTaskAssignments } from "./task-assignment";
import { sessionCanSeeOwner } from "./owner-boundary";
import { WorkHubAccessError } from "./context-access";

export function taskCreationAccess(session: SessionPayload, owner: WorkHubOwner, assigneeUserId?: number | null) {
  if (!sessionCanSeeOwner(session, owner.type, owner.id)) throw new WorkHubAccessError("not_found");
  if (canManageTaskAssignments(session)) return "manager";
  // Preserve the existing supervisor's site-scoped assignment path; the route
  // still requires task.assign for its supplied gate/site context.
  if (session.vendorRole === "gate_supervisor" && assigneeUserId != null) return "supervisor";
  const gatekeeper = owner.type === "vendor" && owner.id === session.vendorId &&
    (["gatekeeper", "gate_supervisor"].includes(session.vendorRole ?? "") || Boolean(session.managedSubcontractor));
  if (!gatekeeper || assigneeUserId != null) throw new WorkHubAccessError("forbidden");
  return "hopper";
}

/** Any current member may resolve an unassigned task in their own company. */
export function isUnassignedTaskCompletion(task: { assigneeUserId: number | null; channelId?: string | null; status: string }, payload: Record<string, unknown>) {
  return task.assigneeUserId == null && task.channelId == null && ["open", "in_progress"].includes(task.status) &&
    payload.action === "complete" && typeof payload.resolution === "string" && Boolean(payload.resolution.trim()) &&
    Object.keys(payload).every(key => ["action", "resolution"].includes(key));
}
