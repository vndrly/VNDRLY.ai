import { z } from "zod/v4";
import { SESSION_SECRET, type SessionPayload } from "../lib/session";
import { chatGptActionTools, chatGptReadableTools } from "./chatgpt-tool-access";
import { readExactPlanTask } from "./coordinated-plan-exact-task";
import { decodePlanDescription } from "./coordinated-plan";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { prepareBoundExecutionProposal, planExecutionProposalInputSchema } from "./plan-execution-approval";
import { createPlanExecutionConsentService } from "./plan-execution-consent";
import type { PlanExecutionRun } from "./plan-execution";
import { ASSISTANT_ISSUER } from "./chatgpt-oauth";

export const PLAN_EXECUTION_PREPARE_TOOL = {
  name: "v_prepare_background_work",
  description: "Prepare exact bounded saved-plan reads and an optional self-assigned company review draft for separate authenticated approval. Supported read families are tasks, recorded invoices and receivable aging, ticket review queues, Gate stations and change-over, workforce coverage and roster candidates, visible Hotlist jobs, Work Hub calendar, and asset custody. Each read still requires the connected user's current permissions and exact saved-plan intent. Records alone do not prove invoice eligibility, qualified Gate candidates, Hotlist service matching, physical attendance or possession. Never starts execution. No outgoing message, calendar change, payment, device capture or continuous monitoring. Company drafts have normal company visibility. The signed review expires in five minutes.",
  inputSchema: { ...z.toJSONSchema(planExecutionProposalInputSchema), type: "object" as const },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};
export const PLAN_EXECUTION_STATUS_TOOL = {
  name: "v_background_work_status", description: "Read this account's exact saved background run and verified results. Pending is not started; completed concerns only the listed adapters. Saved inbox notification does not prove delivery or audible alert.",
  inputSchema: { type: "object" as const, properties: { reference: { type: "string", format: "uuid" } }, required: ["reference"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
export const PLAN_EXECUTION_CANCEL_TOOL = {
  ...PLAN_EXECUTION_STATUS_TOOL, name: "v_cancel_background_work", description: "Cancel this account's exact saved delegation when explicitly requested. Prevents further effects, but cannot undo an issued command. Unknown prior outcomes remain unknown.",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};
export function planExecutionPublicRun(run: PlanExecutionRun) {
  const { grantReference: _private, ...authorization } = run.authorization;
  return { reference: authorization.id, authorization, state: run.state, revision: run.revision, cancelRequested: run.cancelRequested,
    workerAttemptStarted: run.steps.some(step => step.attempts > 0), steps: run.steps, brief: run.brief ?? null,
    notificationSaved: run.notificationSaved, detail: run.detail ?? null, originalPlanCheckpointsUpdated: false };
}
export async function handlePlanExecutionTool(name: string, input: unknown, session: SessionPayload, scopes: string[], grantReference: string) {
  if (process.env.ASSISTANT_PLAN_EXECUTION_ENABLED !== "1") throw Error("Background work unavailable");
  const service = createPlanExecutionConsentService({ secret: SESSION_SECRET });
  if (name !== PLAN_EXECUTION_PREPARE_TOOL.name) {
    const { reference } = z.object({ reference: z.uuid() }).strict().parse(input);
    if (name === PLAN_EXECUTION_STATUS_TOOL.name) {
      if (!chatGptReadableTools(session, scopes).some(tool => tool.name === "list_work_hub_tasks")) throw Error("Current plan read unavailable");
      let run: PlanExecutionRun;
      try { run = await service.status(reference, session); }
      catch {
        const metadata = await service.statusMetadata(reference, session, grantReference);
        return { ...metadata, savedResultsAvailable: false,
          detail: "Saved run status only. Current delegation or plan authority does not permit releasing its previous results; no execution was authorized." };
      }
      if (!grantReference || run.authorization.grantReference !== grantReference) throw Error("Background connection changed");
      return { ...planExecutionPublicRun(run), savedResultsAvailable: true };
    }
    if (name === PLAN_EXECUTION_CANCEL_TOOL.name) {
      const run = await service.cancel(reference, session);
      // Owner revocation is allowed without exposing results from another grant.
      return { reference: run.authorization.id, state: run.state, cancelRequested: run.cancelRequested,
        revision: run.revision, priorEffectsUndone: false, priorUnknownOutcomesVerified: false };
    }
    throw Error("Unsupported background operation");
  }
  const request = planExecutionProposalInputSchema.parse(input);
  const organizationKey = session.role === "partner" && session.partnerId ? `partner:${session.partnerId}` : session.vendorId ? `vendor:${session.vendorId}` : null;
  if (!organizationKey || !session.userId || !session.activeMembershipId || !session.sv || !grantReference) throw Error("Current connection unavailable");
  const available = new Set([...chatGptReadableTools(session, scopes), ...chatGptActionTools(session, scopes)].map(tool => tool.name));
  if (!available.has("list_work_hub_tasks") || !available.has("manage_work_hub_task")) throw Error("Background plan unavailable");
  const identity = { userId: session.userId, organizationKey };
  const task = await readExactPlanTask(path => callNaturalVoiceDomainApi(path, "GET", {}, session), request.taskId, identity);
  if (["completed", "cancelled"].includes(task.status)) throw Error("Saved plan is terminal");
  const proposal = prepareBoundExecutionProposal(decodePlanDescription(task.description, identity), {
    requester: { ...identity, membershipId: session.activeMembershipId, sessionVersion: session.sv }, grantReference,
    taskId: task.id, taskVersion: task.version, availableTools: available,
  }, request);
  const prepared = await service.prepare(proposal, session);
  const { token, ...review } = prepared;
  return { ...review, reference: proposal.id, approvalUrl: `${ASSISTANT_ISSUER}/executions/review?token=${encodeURIComponent(token)}` };
}
