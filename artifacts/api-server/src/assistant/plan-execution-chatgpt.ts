import { z } from "zod/v4";
import { SESSION_SECRET, type SessionPayload } from "../lib/session";
import { chatGptActionTools, chatGptReadableTools } from "./chatgpt-tool-access";
import { invoiceActivityAvailable } from "./invoice-activity-chatgpt";
import { ticketInvoicePreparationAvailable } from "./ticket-invoice-preparation-tools";
import { availableWorkdayOpportunityTools } from "./workday-opportunity-chatgpt";
import { readExactPlanTask } from "./coordinated-plan-exact-task";
import { decodePlanDescription } from "./coordinated-plan";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { prepareBoundExecutionProposal, planExecutionProposalInputSchema } from "./plan-execution-approval";
import { createPlanExecutionConsentService } from "./plan-execution-consent";
import type { PlanExecutionRun } from "./plan-execution";
import { ASSISTANT_ISSUER } from "./chatgpt-oauth";

export const PLAN_EXECUTION_PREPARE_TOOL = {
  name: "v_prepare_background_work",
  description: "Prepare exact saved-plan reads and supported effects for separate authenticated whole-plan approval: selected eligible ticket invoice drafts under the strict >15-day recorded-history condition; exact saved-occurrence calendar reschedule; your own bounded away responder configure/pause/revoke; or a self-assigned company review draft. Each step requires current permissions, originating grant and exact saved intent; preparation grants no authority. Payment-queue reads use query_tickets approved/awaiting_payment with bounded sinceDays/limit; approved alone or a capped window is not the full queue. Unknown eligibility/history/availability must remain unknown. Never starts execution. The same-account human must approve the exact proposal within five minutes. Company drafts have normal company visibility. No payment transfer, invoice issue/email, generic outgoing messages, Gate assignment, Hotlist bid, external attendee acceptance, device capture or continuous monitoring. Notifications do not prove delivery.",
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
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
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
  if (invoiceActivityAvailable(session, scopes)) available.add("query_invoice_activity");
  for(const tool of availableWorkdayOpportunityTools(session,scopes))available.add(tool.name);
  if(ticketInvoicePreparationAvailable(session,scopes))available.add("prepare_ticket_invoices");
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
