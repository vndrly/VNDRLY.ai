import { pgTable, serial, timestamp, integer, text } from "drizzle-orm/pg-core";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

export const ticketUnlocksTable = pgTable("ticket_unlocks", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  unlockedById: integer("unlocked_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  previousStatus: text("previous_status").notNull(),
  reason: text("reason").notNull().default(""),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TicketUnlock = typeof ticketUnlocksTable.$inferSelect;
