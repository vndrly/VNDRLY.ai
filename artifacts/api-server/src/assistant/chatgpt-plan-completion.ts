import { verifySavedGateVisitCompletion } from "./plan-gate-visit-proof";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { checkpointPlan, encodePlanDescription, type PlanIdentity } from "./coordinated-plan";
import { resumedWorkPlan } from "./chatgpt-coordinated-plan";
import { planReadReceiptSchema } from "./chatgpt-plan-read-checkpoint";
import { issuePlanCompletionProof, verifiedPlanCompletionIds, verifySavedTicketCompletion } from "./plan-completion-proof";
import { verifySavedWorkHubTaskCompletion } from "./plan-work-hub-task-proof";
import { verifySavedWorkHubMeetingCompletion } from "./plan-work-hub-meeting-proof";
import { verifySavedWorkHubMessageCompletion } from "./plan-work-hub-message-proof";

export const PLAN_COMPLETION_TOOL = {
  name: "v_prepare_work_plan_completion",
  description: "Prepare an evidence-linked checkpoint for an explicitly configured plan step using the existing authorization panel. Planned reads require a successful server-issued receipt and record observed queries only. Saved action checkpoints require an exact completed action reference and fresh canonical readback: ticket submit/approve/cancel, Work Hub task create/complete/cancel, meeting create/cancel, or exact saved text messages. Text messages check the current channel, author, exact text/reply and unedited record; they do not prove delivery or readership. Meeting creation checks the exact title, start/end and timezone; cancellation checks the exact occurrence and cancelled state. Meeting records have no revision field; these checks do not assert attendance, capture or notification delivery. Task creation checks the exact planned title and any specified assignee; status changes check exact task ID and saved/current versions. Rechecks current account, permissions, versions and dependencies at approval. Pending or prepared actions are not saved work. A task workflow status is not physical-work proof. Does not execute the business action or start background work.",
  inputSchema: { type: "object" as const, properties: { taskId: { type: "string", format: "uuid" }, expectedTaskVersion: { type: "integer", minimum: 1 }, stepId: { type: "string" }, receipt: { type: "string", maxLength: 12000 }, actionReference: { type: "string", maxLength: 200 } }, required: ["taskId", "expectedTaskVersion", "stepId"], additionalProperties: false },
  outputSchema: { type: "object" as const, properties: { ok: { type: "boolean" }, requiresConfirmation: { type: "boolean" }, status: { type: "string", enum: ["pending", "running", "completed", "outcome_unknown"] }, toolName: { type: "string" }, reference: { type: "string" }, approvalUrl: { type: "string" }, result: { type: ["object", "array", "string", "number", "boolean", "null"] }, message: { type: "string" } }, required: ["ok", "requiresConfirmation", "status", "toolName", "reference", "approvalUrl", "result", "message"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};
export const planCompletionRequestSchema = z.object({ taskId: z.string().uuid(), expectedTaskVersion: z.number().int().positive(), stepId: z.string().min(1).max(100), receipt: z.string().max(12000).optional(), actionReference: z.string().min(1).max(200).optional() }).strict().refine(input => Number(Boolean(input.receipt)) + Number(Boolean(input.actionReference)) === 1, "Supply exactly one server evidence reference");
/** Evidence values are server retrieved/verified, never model assertions. Call again with fresh records at approval. */
export function preparePlanCompletion(tasks: unknown, input: unknown, identity: PlanIdentity, owner: { type: "vendor" | "partner"; id: number }, available: ReadonlySet<string>, availableReads: ReadonlySet<string>, evidence: { receipt?: unknown; action?: unknown; ticket?: unknown; resource?: unknown }, secret: string, now: number, observedAt = now) {
  const request = planCompletionRequestSchema.parse(input);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(observedAt) || observedAt > now) throw Error("Invalid completion observation time");
  if (identity.organizationKey !== `${owner.type}:${owner.id}`) throw Error("Plan company mismatch");
  const resumed = resumedWorkPlan(tasks, request.taskId, identity, available, now, (id, plan) => verifiedPlanCompletionIds(secret, id, plan));
  if (resumed.taskVersion !== request.expectedTaskVersion) throw Error("Task version changed");
  if (!resumed.taskStatus || ["completed", "cancelled"].includes(resumed.taskStatus)) throw Error("Plan task is terminal");
  const step = resumed.plan.steps.find(row => row.id === request.stepId);
  if (!step || !resumed.eligibleStepIds.includes(step.id)) throw Error("Plan step no longer eligible");
  let evidenceHash: string;
  if (step.completion?.kind === "planned_read_observed") {
    if (!request.receipt || request.actionReference) throw Error("Planned read receipt required");
    const receipt = planReadReceiptSchema.parse(evidence.receipt);
    if (receipt.expires <= now || Date.parse(receipt.observedAt) > now || receipt.userId !== identity.userId || receipt.organizationKey !== identity.organizationKey || receipt.taskId !== request.taskId || receipt.taskVersion !== resumed.taskVersion || receipt.planVersion !== resumed.plan.version || receipt.stepId !== step.id) throw Error("Read receipt no longer matches current plan");
    if (receipt.observations.length !== new Set(step.toolNames).size || new Set(receipt.observations.map(row => row.toolName)).size !== receipt.observations.length || receipt.observations.some(row => row.failed || !step.toolNames.includes(row.toolName) || !availableReads.has(row.toolName))) throw Error("Read receipt failed or tools unavailable");
    evidenceHash = createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
  } else if (step.completion?.kind === "canonical_ticket_action_saved") {
    if (!request.actionReference || request.receipt || !availableReads.has("query_ticket_detail")) throw Error("Saved ticket action and current ticket read permission required");
    evidenceHash = verifySavedTicketCompletion(step, evidence.action, evidence.ticket).evidenceHash;
  } else if (step.completion?.kind === "canonical_work_hub_task_action_saved") {
    if (!request.actionReference || request.receipt || !availableReads.has("list_work_hub_tasks")) throw Error("Saved task action and current task read permission required");
    evidenceHash = verifySavedWorkHubTaskCompletion(step, evidence.action, evidence.resource, identity).evidenceHash;
  } else if (step.completion?.kind === "canonical_work_hub_meeting_action_saved") {
    if (!request.actionReference || request.receipt || !availableReads.has("get_work_hub_calendar_item")) throw Error("Saved meeting action and current calendar item read permission required");
    evidenceHash = verifySavedWorkHubMeetingCompletion(step, evidence.action, evidence.resource, identity).evidenceHash;
  } else if(step.completion?.kind === "canonical_gate_visit_action_saved") {
    if(!request.actionReference||request.receipt||!availableReads.has("search_gate_history"))throw Error("Saved Gate action and current history read permission required");
    evidenceHash=verifySavedGateVisitCompletion(step,evidence.action,evidence.resource).evidenceHash;
  } else if (step.completion?.kind === "canonical_work_hub_message_saved") {
    if (!request.actionReference || request.receipt || !availableReads.has("list_work_hub_messages")) throw Error("Saved message action and current channel message read permission required");
    evidenceHash=verifySavedWorkHubMessageCompletion(step,evidence.action,evidence.resource,identity).evidenceHash;
  } else throw Error("Unsupported plan completion intent");
  const proof = issuePlanCompletionProof(secret, request.taskId, resumed.plan, step.id, evidenceHash, observedAt);
  const plan = checkpointPlan(resumed.plan, identity, resumed.plan.version, step.id, { state: "completed", resultReferences: [proof], detail: `${step.completion.kind === "planned_read_observed" ? "Planned reads observed; no business action asserted" : step.completion.kind === "canonical_gate_visit_action_saved" ? "Saved Gate visit state checked; no physical presence, admission, departure or GPS proof" : step.completion.kind === "canonical_work_hub_task_action_saved" ? "Saved Work Hub task action and exact canonical version checked; task status is not physical-work proof" : step.completion.kind === "canonical_work_hub_meeting_action_saved" ? "Saved meeting action and exact current occurrence checked; no attendance, capture or delivery asserted" : step.completion.kind === "canonical_work_hub_message_saved" ? "Saved text message and exact current channel record checked; no delivery or readership asserted" : "Saved ticket action and canonical outcome checked"} at ${new Date(observedAt).toISOString()}. Historical evidence does not grant access or execute later work.` });
  return { owner, context: { kind: "organization", id: owner.id }, taskId: request.taskId, expectedVersion: resumed.taskVersion, action: "update", payload: { status: resumed.taskStatus, description: encodePlanDescription(plan) } };
}
