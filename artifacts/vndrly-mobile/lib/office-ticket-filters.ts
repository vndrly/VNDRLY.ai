import type { MobileOpenTicket } from "./portal-tickets";
import { ticketStaleDays } from "./ticketStatusLabels";
export type OfficeTicketFilter = "active" | "stale" | "flagged" | "completed" | "kickbacks";
const completed = new Set(["completed", "submitted", "approved", "awaiting_payment", "funds_dispersed"]);
export function filterOfficeTickets(rows: MobileOpenTicket[], filter: OfficeTicketFilter, flaggedIds: readonly number[]) {
 const flags = new Set(flaggedIds);
 return rows.filter(row => {
   if (filter === "flagged") return flags.has(row.id);
   if (filter === "completed") return completed.has(row.status);
   if (filter === "kickbacks") return row.status === "kicked_back";
   if (filter === "stale") return ticketStaleDays(row.status, row.updatedAt ?? row.createdAt) !== null;
   return !completed.has(row.status) && !["cancelled", "denied", "kicked_back"].includes(row.status);
 }).sort((a,b) => (Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)||b.id-a.id);
}
