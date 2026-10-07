import { currentPlanExecutionAuthority } from "./plan-execution-authorization";
import { createTicketInvoiceCandidatesHandler } from "./ticket-invoice-candidates-tools";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import {
  planExecutionFingerprint,
  planExecutionResultSchema,
  type PlanExecutionAuthorization,
  type PlanExecutionStep,
} from "./plan-execution";

export function createPlanTicketInvoiceCandidatesRead(
  overrides: {
    authorize?: typeof currentPlanExecutionAuthority;
    request?: typeof callNaturalVoiceDomainApi;
    now?: () => number;
  } = {},
) {
  const authorize = overrides.authorize ?? currentPlanExecutionAuthority,
    handle = createTicketInvoiceCandidatesHandler(overrides.request),
    now = overrides.now ?? Date.now;
  return async (
    authorization: PlanExecutionAuthorization,
    step: PlanExecutionStep,
  ) => {
    if (
      step.adapter !== "authorized_read" ||
      step.toolName !== "query_ticket_invoice_candidates" ||
      !authorization.steps.some(
        (saved) =>
          planExecutionFingerprint(saved) === planExecutionFingerprint(step),
      )
    )
      throw Error("Invoice candidate read differs from approved operation");
    const before = await authorize(authorization);
    if (!before.current.availableTools.includes(step.toolName))
      throw Error("Invoice candidate read unavailable");
    const output = await handle(step.arguments, before.session, before.scopes);
    await authorize(authorization);
    const age = now() - Date.parse(output.observedAt);
    if (
      `vendor:${output.company.id}` !==
        authorization.requester.organizationKey ||
      !Number.isFinite(age) ||
      age < -5000 ||
      age > 300000
    )
      throw Error(
        "Invoice candidate source is stale or outside approved company",
      );
    return planExecutionResultSchema.parse({
      operationId: step.operationId,
      sourceReferences: [
        `query:query_ticket_invoice_candidates:vendor:${output.company.id}:${output.observedAt}`,
        ...output.tickets.map(
          (ticket) =>
            `ticket:${ticket.ticketId}:updatedAt:${ticket.expectedUpdatedAt}`,
        ),
      ],
      summary: JSON.stringify({
        ...output,
        interpretation:
          "Saved candidate versions only. Explicit selected ticket approval and fresh canonical eligibility/chronology checks are required before generation; no invoice or approval created.",
      }),
    });
  };
}
