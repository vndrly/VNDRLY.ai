import { pgTable, serial, timestamp, integer, text, index } from "drizzle-orm/pg-core";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

export const ticketStatusHistoryTable = pgTable("ticket_status_history", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => ticketsTable.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  actorRole: text("actor_role"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  ticketStatusTimeIdx: index("ticket_status_history_ticket_status_time_idx").on(t.ticketId, t.toStatus, t.createdAt),
}));

export type TicketStatusHistoryRow =
  typeof ticketStatusHistoryTable.$inferSelect;
export type InsertTicketStatusHistory =
  typeof ticketStatusHistoryTable.$inferInsert;
