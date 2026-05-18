import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ticketsTable } from "./tickets";

export const ticketLineItemsTable = pgTable("ticket_line_items", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  // T005: per-line tax rate as a decimal fraction (e.g. 0.0825 = 8.25%).
  // Nullable: most labor lines are non-taxable so callers leave it null;
  // only equipment / parts / day-rate labor lines that the vendor knows are
  // taxable carry a value. Invoice generation multiplies (quantity *
  // unit_price * tax_rate) and surfaces the tax as a separate sub-row.
  taxRate: numeric("tax_rate", { precision: 6, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketLineItemSchema = createInsertSchema(ticketLineItemsTable).omit({ id: true, createdAt: true });
export type InsertTicketLineItem = z.infer<typeof insertTicketLineItemSchema>;
export type TicketLineItem = typeof ticketLineItemsTable.$inferSelect;
