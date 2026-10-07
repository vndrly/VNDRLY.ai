import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import type { CoordinatedPlan, PlanStepInput } from "./coordinated-plan";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const intent = (step: PlanStepInput) => ({ id: step.id, specialist: step.specialist, toolNames: step.toolNames, dependsOn: step.dependsOn, completion: step.completion });
function signature(secret: string, taskId: string, plan: CoordinatedPlan, step: PlanStepInput, evidenceHash: string, observedAt: number) {
  return createHmac("sha256", secret).update(JSON.stringify(["work-plan-completion-v1", taskId, plan.id, plan.identity, intent(step), evidenceHash, observedAt])).digest("base64url");
}
/** Historical receipt, not a permission token. Fresh authority and canonical readback remain required for new work. */
export function issuePlanCompletionProof(secret: string, taskId: string, plan: CoordinatedPlan, stepId: string, evidenceHash: string, observedAt: number): string {
  z.string().uuid().parse(taskId);
  z.string().regex(/^[a-f0-9]{64}$/).parse(evidenceHash);
  z.number().int().nonnegative().parse(observedAt);
  const step = plan.steps.find(row => row.id === stepId);
  if (!step?.completion) throw Error("Plan completion intent required");
  return `plan-proof:v1:${evidenceHash}:${observedAt}:${signature(secret, taskId, plan, step, evidenceHash, observedAt)}`;
}
export function verifiedPlanCompletionIds(secret: string, taskId: string, plan: CoordinatedPlan): ReadonlySet<string> {
  const verified = new Set<string>();
  for (let pass = 0; pass < plan.steps.length; pass++) for (const step of plan.steps) {
    if (step.state !== "completed" || !step.completion || !step.dependsOn.every(id => verified.has(id))) continue;
    if (step.resultReferences.length !== 1) continue;
    const match = /^plan-proof:v1:([a-f0-9]{64}):(\d+):([A-Za-z0-9_-]{43})$/.exec(step.resultReferences[0]);
    if (!match || !Number.isSafeInteger(Number(match[2]))) continue;
    const expected = Buffer.from(signature(secret, taskId, plan, step, match[1], Number(match[2]))), actual = Buffer.from(match[3]);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) verified.add(step.id);
  }
  return verified;
}
/** action must be retrieved from the current actor/company's durable prepared-action store; ticket from a fresh authorized canonical read. */
export function verifySavedTicketCompletion(step: PlanStepInput, actionValue: unknown, ticketValue: unknown) {
  if (step.completion?.kind !== "canonical_ticket_action_saved") throw Error("Unsupported plan completion");
  const desired = step.completion;
  const named = `manage_ticket_record_${desired.action}`;
  if (step.toolNames.length !== 1 || step.toolNames[0] !== named) throw Error("Plan action intent mismatch");
  const action = z.object({ state: z.literal("completed"), toolName: z.literal("manage_ticket_record"), arguments: z.object({ action: z.literal(desired.action), ticketId: z.literal(desired.ticketId) }), result: z.string(), executionFingerprint: z.string().min(1) }).parse(actionValue);
  const status = { submit: "submitted", approve: "approved", cancel: "cancelled" }[desired.action];
  const result = z.object({ id: z.literal(desired.ticketId), status: z.literal(status), error: z.unknown().optional(), ok: z.boolean().optional() }).passthrough().parse(JSON.parse(action.result));
  if (result.error || result.ok === false) throw Error("Saved action failed");
  const ticket = z.object({ ticketId: z.literal(desired.ticketId), status: z.literal(status) }).passthrough().parse(ticketValue);
  return { ticketId: ticket.ticketId, action: desired.action, status, evidenceHash: hash({ operation: action.executionFingerprint, arguments: action.arguments, result, ticket }) };
}
