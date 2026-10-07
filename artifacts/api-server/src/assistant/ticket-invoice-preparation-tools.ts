import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { ticketInvoicePreparationInputSchema } from "../services/ticket-invoice-preparation";

export const TICKET_INVOICE_PREPARATION_ARGUMENTS = z.object({
  basis: ticketInvoicePreparationInputSchema.shape.basis,
  tickets: ticketInvoicePreparationInputSchema.shape.tickets,
}).strict().refine(value => new Set(value.tickets.map(ticket => ticket.ticketId)).size === value.tickets.length, "Select each ticket once");
export const TICKET_INVOICE_PREPARATION_TOOL = {
  name: "prepare_ticket_invoices",
  description: "Prepare authenticated approval of canonical invoice drafts for explicitly selected approved, uninvoiced tickets at their exact saved versions, only if the current recorded invoice chronology is strictly older than 15 days. Unknown history refuses. Requires current vendor Billing authority and both finance:read and finance:write consent. Preparation alone saves no invoice; the authenticated person must approve the exact action or an exact saved plan delegation. Never issues, sends email, records payment or transfers money.",
  inputSchema: { ...z.toJSONSchema(TICKET_INVOICE_PREPARATION_ARGUMENTS), type: "object" as const },
  securitySchemes: [{ type: "oauth2" as const, scopes: ["finance:read", "finance:write"] }],
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};
export function ticketInvoicePreparationAvailable(session: SessionPayload, scopes: readonly string[]) {
  return session.role === "vendor" && Boolean(session.vendorId && session.userId && session.activeMembershipId && session.sv) && scopes.includes("finance:read") && scopes.includes("finance:write");
}
/** Used only behind the authenticated action approval boundary or approved executor. */
export function ticketInvoicePreparationCommand(raw: unknown, operationId: string) {
  return ticketInvoicePreparationInputSchema.parse({ ...TICKET_INVOICE_PREPARATION_ARGUMENTS.parse(raw), operationId });
}
