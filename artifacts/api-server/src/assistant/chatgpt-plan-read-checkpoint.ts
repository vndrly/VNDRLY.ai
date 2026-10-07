import { z } from "zod/v4";
import { checkpointPlan, encodePlanDescription, type PlanIdentity } from "./coordinated-plan";
import { resumedWorkPlan } from "./chatgpt-coordinated-plan";

export const PLAN_READ_CHECKPOINT_TOOL = {
  name: "v_prepare_work_plan_read_checkpoint",
  description: "Prepare saving a server-issued planned-read receipt in the existing Work Hub action panel. Receipts come only from v_run_work_plan_read. Saves observed lookup success/failure and puts the step in waiting or failed; never marks the business work completed or starts background execution.",
  inputSchema: { type: "object" as const, properties: { receipt: { type: "string", maxLength: 12000 } }, required: ["receipt"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const receiptSchema = z.object({
  kind: z.literal("plan-read-checkpoint"), id: z.string().uuid(),
  userId: z.number().int().positive(), organizationKey: z.string().min(1),
  taskId: z.string().uuid(), taskVersion: z.number().int().positive(), planVersion: z.number().int().positive(),
  stepId: z.string().min(1).max(100), expires: z.number().finite(), observedAt: z.string().datetime(),
  observations: z.array(z.object({ toolName: z.string().min(1), failed: z.boolean(), resultHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(50),
}).strict();
export type PlanReadReceipt = z.infer<typeof receiptSchema>;

/** receiptValue must already have passed the server's signed-envelope verifier. */
export function preparePlanReadCheckpoint(tasks: unknown, receiptValue: unknown, identity: PlanIdentity, owner: { type: "vendor" | "partner"; id: number }, availableReads: ReadonlySet<string>, now: number) {
  const receipt = receiptSchema.parse(receiptValue);
  if (receipt.expires <= now || Date.parse(receipt.observedAt) > now) throw Error("Plan read receipt expired or invalid");
  if (receipt.userId !== identity.userId || receipt.organizationKey !== identity.organizationKey || identity.organizationKey !== `${owner.type}:${owner.id}`) throw Error("Plan read receipt identity changed");
  const resumed = resumedWorkPlan(tasks, receipt.taskId, identity, availableReads);
  if (resumed.taskVersion !== receipt.taskVersion || resumed.plan.version !== receipt.planVersion) throw Error("Plan changed after lookup");
  if (!resumed.taskStatus || ["completed", "cancelled"].includes(resumed.taskStatus)) throw Error("Plan task is terminal");
  const step = resumed.plan.steps.find(row => row.id === receipt.stepId);
  if (!step || !resumed.eligibleStepIds.includes(step.id)) throw Error("Plan step no longer eligible");
  if (receipt.observations.length !== new Set(step.toolNames).size || new Set(receipt.observations.map(row => row.toolName)).size !== receipt.observations.length || receipt.observations.some(row => !step.toolNames.includes(row.toolName) || !availableReads.has(row.toolName))) throw Error("Plan read tools changed");
  const failures = receipt.observations.filter(row => row.failed).length;
  const plan = checkpointPlan(resumed.plan, identity, receipt.planVersion, receipt.stepId, {
    state: failures ? "failed" : "waiting",
    resultReferences: receipt.observations.map(row => `plan-read:${receipt.id}:${row.toolName}:${row.resultHash}`),
    detail: `Lookup observed at ${receipt.observedAt}: ${receipt.observations.length - failures} successful, ${failures} failed. Business work is not marked completed; review actual results before continuing.`,
  });
  return { owner, context: { kind: "organization", id: owner.id }, taskId: receipt.taskId, expectedVersion: receipt.taskVersion, action: "update", payload: { status: resumed.taskStatus, description: encodePlanDescription(plan) } };
}
