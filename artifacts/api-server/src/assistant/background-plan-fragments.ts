import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import type { CoordinatedPlan } from "./coordinated-plan";
import {
  PLAN_OPERATION_INPUTS,
  planOperationStepSchema,
  typedPlanProposalStepSchema,
} from "./plan-operation-inputs";
import {
  planExecutionFingerprint,
  planExecutionRequesterSchema,
} from "./plan-execution";
import {
  prepareBoundExecutionProposal,
  type TrustedExecutionProposalContext,
} from "./plan-execution-approval";

export const backgroundFragmentInputSchema = z
  .object({
    taskId: z.uuid(),
    expectedTaskVersion: z.number().int().positive(),
    expectedPlanVersion: z.number().int().positive(),
    id: z.string().min(1).max(100),
    arguments: z.record(z.string(), z.json()),
  })
  .strict();
export const backgroundAssemblyInputSchema = z
  .object({
    taskId: z.uuid(),
    expectedTaskVersion: z.number().int().positive(),
    expectedPlanVersion: z.number().int().positive(),
    expiresInMinutes: z.number().int().min(1).max(1440),
    maxAttempts: z.number().int().min(1).max(5),
    fragmentReferences: z.array(z.string().min(1).max(16000)).min(1).max(20),
  })
  .strict();
const claimsSchema = z
  .object({
    kind: z.literal("background-plan-fragment-v1"),
    requester: planExecutionRequesterSchema,
    grantHash: z.string().regex(/^[a-f0-9]{64}$/),
    taskId: z.uuid(),
    taskVersion: z.number().int().positive(),
    planId: z.uuid(),
    planVersion: z.number().int().positive(),
    planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.number(),
    expiresAt: z.number(),
    step: z
      .object({
        id: z.string().min(1).max(100),
        adapter: z.enum([
          "authorized_read",
          "personal_draft",
          "ticket_invoice_preparation",
          "calendar_reschedule",
          "away_responder",
          "calendar_confirmation",
        ]),
        toolName: z.string(),
        arguments: z.record(z.string(), z.json()),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (!typedPlanProposalStepSchema.safeParse(value).success)
          ctx.addIssue({
            code: "custom",
            message: "Invalid typed background step",
          });
      }),
  })
  .strict();
const grantHash = (grant: string) =>
  createHash("sha256").update(grant).digest("hex");
const signature = (body: string, secret: string) =>
  createHmac("sha256", secret)
    .update("vndrly-background-fragment-v1:" + body)
    .digest("base64url");
function matching(
  plan: CoordinatedPlan,
  context: TrustedExecutionProposalContext,
  taskId: string,
  taskVersion: number,
  planVersion: number,
) {
  if (
    !context.grantReference ||
    plan.identity.userId !== context.requester.userId ||
    plan.identity.organizationKey !== context.requester.organizationKey ||
    taskId !== context.taskId ||
    taskVersion !== context.taskVersion ||
    planVersion !== plan.version
  )
    throw Error("Background fragment context changed");
}
export function prepareBackgroundFragment(
  name: string,
  raw: unknown,
  plan: CoordinatedPlan,
  context: TrustedExecutionProposalContext,
  secret: string,
  now = Date.now(),
) {
  const operation = PLAN_OPERATION_INPUTS.find(
    (value) =>
      "v_plan_step__" + value.key === name &&
      context.availableTools.has(value.toolName),
  );
  if (!operation) throw Error("Background operation unavailable");
  const input = backgroundFragmentInputSchema.parse(raw);
  matching(
    plan,
    context,
    input.taskId,
    input.expectedTaskVersion,
    input.expectedPlanVersion,
  );
  const step = planOperationStepSchema(operation).parse({
    id: input.id,
    adapter: operation.adapter,
    toolName: operation.toolName,
    arguments: input.arguments,
  });
  const saved = plan.steps.find((value) => value.id === step.id);
  if (
    !saved ||
    saved.state !== "pending" ||
    !saved.toolNames.includes(step.toolName)
  )
    throw Error("Saved step changed");
  const claims = claimsSchema.parse({
    kind: "background-plan-fragment-v1",
    requester: context.requester,
    grantHash: grantHash(context.grantReference),
    taskId: context.taskId,
    taskVersion: context.taskVersion,
    planId: plan.id,
    planVersion: plan.version,
    planFingerprint: planExecutionFingerprint(plan),
    issuedAt: now,
    expiresAt: now + 300000,
    step,
  });
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return {
    fragmentReference: body + "." + signature(body, secret),
    expiresAt: claims.expiresAt,
    step,
    executionStarted: false,
    approvalGranted: false,
  };
}
export function assembleBackgroundFragments(
  raw: unknown,
  plan: CoordinatedPlan,
  context: TrustedExecutionProposalContext,
  secret: string,
  now = Date.now(),
) {
  const input = backgroundAssemblyInputSchema.parse(raw);
  matching(
    plan,
    context,
    input.taskId,
    input.expectedTaskVersion,
    input.expectedPlanVersion,
  );
  const steps = input.fragmentReferences.map((reference) => {
    const parts = reference.split(".");
    if (parts.length !== 2) throw Error("Invalid background fragment");
    const expected = Buffer.from(signature(parts[0], secret)),
      actual = Buffer.from(parts[1]);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw Error("Invalid background fragment signature");
    const claim = claimsSchema.parse(
      JSON.parse(Buffer.from(parts[0], "base64url").toString()),
    );
    if (
      claim.issuedAt > now ||
      claim.expiresAt <= now ||
      claim.expiresAt - claim.issuedAt !== 300000 ||
      (
        ["userId", "organizationKey", "membershipId", "sessionVersion"] as const
      ).some((key) => claim.requester[key] !== context.requester[key]) ||
      claim.grantHash !== grantHash(context.grantReference) ||
      claim.taskId !== context.taskId ||
      claim.taskVersion !== context.taskVersion ||
      claim.planId !== plan.id ||
      claim.planVersion !== plan.version ||
      claim.planFingerprint !== planExecutionFingerprint(plan) ||
      !context.availableTools.has(claim.step.toolName)
    )
      throw Error("Background fragment authority changed");
    return claim.step;
  });
  return prepareBoundExecutionProposal(
    plan,
    context,
    {
      taskId: input.taskId,
      expectedTaskVersion: input.expectedTaskVersion,
      expectedPlanVersion: input.expectedPlanVersion,
      expiresInMinutes: input.expiresInMinutes,
      maxAttempts: input.maxAttempts,
      steps,
    },
    now,
  );
}
