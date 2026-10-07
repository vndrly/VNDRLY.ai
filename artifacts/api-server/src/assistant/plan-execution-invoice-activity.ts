import { PLAN_EXECUTION_INVOICE_ACTIVITY_INPUT } from "./plan-execution-read-policy";
import { currentPlanExecutionAuthority } from "./plan-execution-authorization";
import { createInvoiceActivityHandler } from "./invoice-activity-chatgpt";
import { readInvoiceActivity } from "./invoice-activity-read";
import { planExecutionFingerprint, planExecutionResultSchema, type PlanExecutionAuthorization, type PlanExecutionStep } from "./plan-execution";

export const PLAN_INVOICE_ACTIVITY_INPUT = PLAN_EXECUTION_INVOICE_ACTIVITY_INPUT;
type Dependencies = { authorize: typeof currentPlanExecutionAuthority; read: typeof readInvoiceActivity; now: () => number };

/** Fixed approved read only; its threshold observation is never invoice preparation authority. */
export function createPlanInvoiceActivityRead(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { authorize: currentPlanExecutionAuthority, read: readInvoiceActivity, now: Date.now, ...overrides };
  const handle = createInvoiceActivityHandler(deps.read);
  return async (authorization: PlanExecutionAuthorization, step: PlanExecutionStep) => {
    if (step.adapter !== "authorized_read" || step.toolName !== "query_invoice_activity"
      || !authorization.steps.some(saved => planExecutionFingerprint(saved) === planExecutionFingerprint(step))) throw Error("Invoice activity differs from exact approved read");
    const args = PLAN_INVOICE_ACTIVITY_INPUT.parse(step.arguments);
    const authority = await deps.authorize(authorization);
    if (!authority.current.availableTools.includes("query_invoice_activity")) throw Error("Invoice activity is not currently available");
    const observed = await handle(args, authority.session, authority.scopes);
    await deps.authorize(authorization);
    const age = deps.now() - Date.parse(observed.observedAt);
    const company = `${observed.company.type}:${observed.company.id}`;
    if (!Number.isFinite(age) || age < -5000 || age > 300000 || company !== authorization.requester.organizationKey) throw Error("Invoice activity observation is stale or outside approved company");
    return planExecutionResultSchema.parse({ operationId: step.operationId,
      sourceReferences: [`query:query_invoice_activity:${company}:${observed.observedAt}`, ...observed.events.flatMap(event => event.sourceReference ? [`record:${event.sourceReference}`] : [])],
      summary: JSON.stringify({ ...observed, interpretation: "Queries observed only. preparationRecommended is a recorded chronology condition, not permission, eligibility, invoice creation, sending or delivery." }),
    });
  };
}
