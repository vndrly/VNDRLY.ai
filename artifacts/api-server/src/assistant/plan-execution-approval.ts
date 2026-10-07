import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { CoordinatedPlan } from "./coordinated-plan";
import {
  planExecutionAuthorizationSchema, planExecutionFingerprint,
  type PlanExecutionAuthorization,
} from "./plan-execution";

export const planExecutionProposalInputSchema = z.object({
  taskId: z.string().uuid(),
  expectedTaskVersion: z.number().int().positive(),
  expectedPlanVersion: z.number().int().positive(),
  expiresInMinutes: z.number().int().min(1).max(1440),
  maxAttempts: z.number().int().min(1).max(5),
  steps: z.array(z.object({
    id: z.string().min(1).max(100),
    adapter: z.enum(["authorized_read", "personal_draft", "ticket_invoice_preparation", "calendar_reschedule"]),
    toolName: z.string().min(1).max(150),
    arguments: z.record(z.string(), z.json()),
  }).strict()).min(1).max(20),
}).strict();

export type TrustedExecutionProposalContext = {
  requester: PlanExecutionAuthorization["requester"];
  grantReference: string;
  taskId: string;
  taskVersion: number;
  availableTools: ReadonlySet<string>;
};

/**
 * Builds the exact review proposal, not approval or execution. The authenticated
 * approval endpoint must recheck this pinned context before persisting a run.
 * Identity, dependencies, expiry and operation UUIDs cannot come from an agent.
 */
export function prepareBoundExecutionProposal(
  plan: CoordinatedPlan,
  context: TrustedExecutionProposalContext,
  rawInput: unknown,
  now = Date.now(),
): PlanExecutionAuthorization {
  const input = planExecutionProposalInputSchema.parse(rawInput);
  if (plan.identity.userId !== context.requester.userId ||
      plan.identity.organizationKey !== context.requester.organizationKey ||
      input.taskId !== context.taskId || input.expectedTaskVersion !== context.taskVersion ||
      input.expectedPlanVersion !== plan.version) throw new Error("Saved execution proposal changed");
  const selected = new Set(input.steps.map(step => step.id));
  if (selected.size !== input.steps.length) throw new Error("Duplicate execution step");
  const steps = input.steps.map(step => {
    const canonical = plan.steps.find(value => value.id === step.id);
    if (!canonical || canonical.state !== "pending" ||
        !canonical.toolNames.includes(step.toolName) || !context.availableTools.has(step.toolName)) {
      throw new Error("Execution step is not currently permitted by the saved plan");
    }
    if (canonical.dependsOn.some(id => !selected.has(id))) {
      throw new Error("Execution proposal must preserve every selected step prerequisite");
    }
    if (step.adapter === "personal_draft" && canonical.completion) {
      const completion = canonical.completion;
      if (completion.kind !== "canonical_work_hub_task_action_saved" || completion.action !== "create" ||
          completion.title !== step.arguments.title ||
          completion.assigneeUserId !== undefined && completion.assigneeUserId !== context.requester.userId) {
        throw new Error("Review draft does not match the saved creation intent");
      }
    }
    return { ...step, dependsOn: [...canonical.dependsOn], operationId: randomUUID() };
  });
  // The core schema additionally checks supported adapters, bounded arguments,
  // unique operations and the complete dependency graph before showing review.
  return planExecutionAuthorizationSchema.parse({
    id: randomUUID(), requester: context.requester, grantReference: context.grantReference,
    taskId: context.taskId, taskVersion: context.taskVersion,
    planId: plan.id, planVersion: plan.version, planFingerprint: planExecutionFingerprint(plan),
    approvedAt: now, expiresAt: now + input.expiresInMinutes * 60_000,
    maxAttempts: input.maxAttempts, steps, notificationOperationId: randomUUID(),
  });
}
