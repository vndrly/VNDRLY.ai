import { TICKET_INVOICE_PREPARATION_ARGUMENTS, ticketInvoicePreparationAvailable, ticketInvoicePreparationCommand } from "./ticket-invoice-preparation-tools";
import { ticketInvoicePreparationReceiptSchema } from "../services/ticket-invoice-preparation";
import { currentPlanExecutionAuthority } from "./plan-execution-authorization";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { planExecutionFingerprint, planExecutionResultSchema, type PlanExecutionAuthorization, type PlanExecutionStep, type PlanExecutionReconciliation } from "./plan-execution";

type Dependencies = { authorize: typeof currentPlanExecutionAuthority; request: typeof callNaturalVoiceDomainApi };
export function createPlanTicketInvoicePreparation(overrides: Partial<Dependencies> = {}) {
  const deps = { authorize: currentPlanExecutionAuthority, request: callNaturalVoiceDomainApi, ...overrides };
  return async (authorization: PlanExecutionAuthorization, step: PlanExecutionStep, readback: boolean): Promise<PlanExecutionReconciliation> => {
    if (step.adapter !== "ticket_invoice_preparation" || step.toolName !== "prepare_ticket_invoices" || !authorization.steps.some(saved => planExecutionFingerprint(saved) === planExecutionFingerprint(step))) throw Error("Invoice preparation differs from approved operation");
    const args = TICKET_INVOICE_PREPARATION_ARGUMENTS.parse(step.arguments);
    if (!step.dependsOn.some(id => authorization.steps.some(read => read.id === id && read.adapter === "authorized_read" && read.toolName === "query_invoice_activity" && read.arguments.basis === args.basis))) throw Error("Invoice preparation requires its exact approved chronology prerequisite");
    const authority = await deps.authorize(authorization);
    if (!ticketInvoicePreparationAvailable(authority.session, authority.scopes) || !authority.current.availableTools.includes(step.toolName)) throw Error("Invoice preparation consent or authority unavailable");
    const command = ticketInvoicePreparationCommand(args, step.operationId);
    const output = await deps.request(`/invoices/ticket-preparation/${readback ? "readback" : "execute"}`, "POST", command, authority.session);
    await deps.authorize(authorization);
    if (!output || typeof output !== "object" || Array.isArray(output) || !Object.hasOwn(output, "receipt")) return { state: "unknown" };
    const raw = (output as { receipt: unknown }).receipt;
    if (readback && raw === null) return { state: "not_found" };
    const receipt = ticketInvoicePreparationReceiptSchema.safeParse(raw);
    if (!receipt.success || receipt.data.operationId !== step.operationId || receipt.data.actorUserId !== authorization.requester.userId || `vendor:${receipt.data.vendorId}` !== authorization.requester.organizationKey || receipt.data.basis !== args.basis) return { state: "unknown" };
    const expectedFingerprint = planExecutionFingerprint({ command, actor: { userId: authorization.requester.userId, vendorId: receipt.data.vendorId, membershipId: authorization.requester.membershipId, sessionVersion: authorization.requester.sessionVersion } });
    if (receipt.data.fingerprint !== expectedFingerprint || receipt.data.status === "prepared" && (receipt.data.invoices.length !== args.tickets.length || receipt.data.invoices.some((invoice, index) => invoice.ticketId !== args.tickets[index].ticketId)) || receipt.data.status === "condition_not_met" && receipt.data.invoices.length !== 0) return { state: "unknown" };
    return { state: "completed", result: planExecutionResultSchema.parse({ operationId: step.operationId, sourceReferences: [`invoice-preparation:${step.operationId}`, ...receipt.data.invoices.map(invoice => `invoice:${invoice.invoiceId}/ticket:${invoice.ticketId}`)], summary: JSON.stringify({ status: receipt.data.status, invoices: receipt.data.invoices, activityObservedAt: receipt.data.activityObservedAt, lastRecordedInvoiceAt: receipt.data.lastRecordedInvoiceAt, emailSent: false, issued: false, paymentRecorded: false }) }) };
  };
}
