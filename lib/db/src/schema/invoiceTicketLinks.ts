import {
  pgTable,
  serial,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { invoicesTable } from "./invoices";
import { ticketsTable } from "./tickets";

export const invoiceTicketLinksTable = pgTable(
  "invoice_ticket_links",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqLink: uniqueIndex("invoice_ticket_link_unique").on(t.invoiceId, t.ticketId),
    idxByTicket: index("invoice_ticket_link_ticket_idx").on(t.ticketId),
  }),
);

export type InvoiceTicketLink = typeof invoiceTicketLinksTable.$inferSelect;
