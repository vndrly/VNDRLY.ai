import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { PlanIdentity, PlanStepInput } from "./coordinated-plan";
const resourceSchema = z.object({ id: z.string().uuid(), ownerOrgType: z.enum(["vendor", "partner"]), ownerOrgId: z.number().int().positive(), version: z.number().int().positive(), title: z.string(), status: z.enum(["open", "in_progress", "completed", "cancelled"]), assigneeUserId: z.number().int().positive().nullable().optional() }).passthrough();
const savedActionSchema = z.object({ state: z.literal("completed"), toolName: z.literal("manage_work_hub_task"), executionFingerprint: z.string().min(1), arguments: z.object({ action: z.enum(["create", "complete", "cancel"]), owner: z.object({ type: z.enum(["vendor", "partner"]), id: z.number().int().positive() }), expectedVersion: z.number().int().positive().nullable().optional(), taskId: z.string().uuid().optional(), payload: z.record(z.string(), z.unknown()) }), result: z.string() });
function savedTaskAction(value: unknown) {
 const action = savedActionSchema.parse(value);
 const receipt = z.object({ operationId: z.string().uuid(), appliedAt: z.string().datetime(), resource: resourceSchema }).passthrough().parse(JSON.parse(action.result));
 if (receipt.error || receipt.ok === false) throw Error("Saved task action failed");
 return { action, receipt };
}
/** Only extracts an ID from the current actor's retrieved durable command result, never from model input. */
export function savedWorkHubTaskResourceId(value: unknown): string { return savedTaskAction(value).receipt.resource.id; }
export function verifySavedWorkHubTaskCompletion(step: PlanStepInput, actionValue: unknown, currentValue: unknown, identity: PlanIdentity) {
 if (step.completion?.kind !== "canonical_work_hub_task_action_saved" || step.toolNames.length !== 1 || step.toolNames[0] !== "manage_work_hub_task") throw Error("Unsupported task completion intent");
 const desired = step.completion;
 const { action, receipt } = savedTaskAction(actionValue);
 const current = resourceSchema.extend({ subjectType: z.literal("task") }).parse(currentValue);
 if (action.arguments.action !== desired.action || `${action.arguments.owner.type}:${action.arguments.owner.id}` !== identity.organizationKey || `${receipt.resource.ownerOrgType}:${receipt.resource.ownerOrgId}` !== identity.organizationKey || `${current.ownerOrgType}:${current.ownerOrgId}` !== identity.organizationKey) throw Error("Task action identity mismatch");
 const status = desired.action === "create" ? "open" : desired.action === "complete" ? "completed" : "cancelled";
 if (current.id !== receipt.resource.id || current.version !== receipt.resource.version || current.status !== status || receipt.resource.status !== status) throw Error("Task canonical outcome changed");
 if (desired.action === "create") {
  if (action.arguments.expectedVersion != null || receipt.resource.version !== 1 || action.arguments.payload.title !== desired.title || receipt.resource.title !== desired.title || current.title !== desired.title) throw Error("Task creation intent mismatch");
  if (desired.assigneeUserId !== undefined && (action.arguments.payload.assigneeUserId !== desired.assigneeUserId || receipt.resource.assigneeUserId !== desired.assigneeUserId || current.assigneeUserId !== desired.assigneeUserId)) throw Error("Task assignee mismatch");
 } else if (desired.taskId !== current.id || action.arguments.taskId !== desired.taskId || action.arguments.expectedVersion == null || receipt.resource.version !== action.arguments.expectedVersion + 1) throw Error("Task operation version or identity mismatch");
 return { resourceId: current.id, operationId: receipt.operationId, evidenceHash: createHash("sha256").update(JSON.stringify({ executionFingerprint: action.executionFingerprint, arguments: action.arguments, receipt, current })).digest("hex") };
}
