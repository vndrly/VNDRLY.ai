export type JourneyTicket = {
  id: number; status: string; siteName: string; partnerName: string; vendorId: number;
  createdAt: string; updatedAt: string; approvedAt: string | null; cancelledAt: string | null;
  kickbackReason: string | null; paid: boolean; finishedAt: string | null;
  invoiceCount: number; paidAmount: string; balanceDue: string;
  reviewStage?: "landman" | "finance";
};
export const journeyCategories = ["offered", "working", "landman", "finance", "kickedBack", "payment", "other"] as const;
export function journeyCategory(ticket: JourneyTicket): typeof journeyCategories[number] {
  if (ticket.status === "awaiting_acceptance") return "offered";
  if (ticket.status === "kicked_back") return "kickedBack";
  if (["approved", "awaiting_payment", "funds_dispersed"].includes(ticket.status)) return "payment";
  if (["submitted", "pending_review", "completed"].includes(ticket.status)) return ticket.reviewStage ?? "landman";
  if (["initiated", "draft", "in_progress"].includes(ticket.status)) return "working";
  return "other";
}
export function partitionTicketJourneys(tickets: JourneyTicket[], now = Date.now()) {
  const unique = [...new Map(tickets.map(ticket => [ticket.id, ticket])).values()];
  const closed = (ticket: JourneyTicket) => ticket.paid || ["cancelled", "denied"].includes(ticket.status);
  return {
    open: unique.filter(ticket => !closed(ticket)),
    history: unique.filter(ticket => closed(ticket) && ticket.finishedAt &&
      Date.parse(ticket.finishedAt) >= now - 30 * 86400000 && Date.parse(ticket.finishedAt) <= now),
  };
}
