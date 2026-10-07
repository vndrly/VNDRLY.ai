import type { SessionPayload } from "../lib/session";
import {
  ticketInvoiceCandidatesInputSchema,
  ticketInvoiceCandidatesOutputSchema,
} from "../services/ticket-invoice-candidates";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { z } from "zod/v4";

export const TICKET_INVOICE_CANDIDATES_TOOL = {
  name: "query_ticket_invoice_candidates",
  description:
    "Read at most 20 current approved, uninvoiced tickets for the authenticated vendor, with exact saved updatedAt versions for explicit invoice preparation review. Current persisted Billing authority is rechecked. Page truncation is explicit; this is not a reservation or a complete company cohort. It creates no approval or invoice and proves no uninvoiced eligibility after this read. Requires finance:read consent. Never issues or sends invoices.",
  inputSchema: {
    ...z.toJSONSchema(ticketInvoiceCandidatesInputSchema),
    type: "object" as const,
  },
  outputSchema: {
    ...z.toJSONSchema(ticketInvoiceCandidatesOutputSchema),
    type: "object" as const,
  },
  securitySchemes: [{ type: "oauth2" as const, scopes: ["finance:read"] }],
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};
export function ticketInvoiceCandidatesAvailable(
  session: SessionPayload,
  scopes: readonly string[],
) {
  return (
    session.role === "vendor" &&
    Boolean(
      session.vendorId &&
      session.userId &&
      session.activeMembershipId &&
      session.sv,
    ) &&
    scopes.includes("finance:read")
  );
}
export function ticketInvoiceCandidatesPath(raw: unknown) {
  const input = ticketInvoiceCandidatesInputSchema.parse(raw);
  return `/invoices/ticket-preparation/candidates?limit=${input.limit}&afterTicketId=${input.afterTicketId}`;
}
export function createTicketInvoiceCandidatesHandler(
  request = callNaturalVoiceDomainApi,
) {
  return async (
    raw: unknown,
    session: SessionPayload,
    scopes: readonly string[],
  ) => {
    if (!ticketInvoiceCandidatesAvailable(session, scopes))
      throw Error("Invoice candidate read consent and current vendor required");
    const input = ticketInvoiceCandidatesInputSchema.parse(raw);
    const output = ticketInvoiceCandidatesOutputSchema.parse(
      await request(ticketInvoiceCandidatesPath(input), "GET", {}, session),
    );
    if (
      output.company.id !== session.vendorId ||
      output.page.limit !== input.limit ||
      output.tickets.length > input.limit ||
      output.tickets.some(
        (ticket, index) =>
          ticket.ticketId <= input.afterTicketId ||
          (index > 0 && output.tickets[index - 1].ticketId >= ticket.ticketId),
      ) ||
      (output.page.truncated &&
        (output.tickets.length !== input.limit ||
          output.page.nextAfterTicketId !== output.tickets.at(-1)?.ticketId)) ||
      (!output.page.truncated && output.page.nextAfterTicketId !== null)
    )
      throw Error("Invoice candidate response differs from selected page");
    return output;
  };
}
export const handleTicketInvoiceCandidatesTool =
  createTicketInvoiceCandidatesHandler();
