import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

export const ticketScheduledNotificationsTable = pgTable(
  "ticket_scheduled_notifications",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ticketUserKindIdx: uniqueIndex("ticket_sched_notif_ticket_user_kind_idx")
      .on(table.ticketId, table.userId, table.kind),
  }),
);

export const insertTicketScheduledNotificationSchema = createInsertSchema(ticketScheduledNotificationsTable).omit({
  id: true,
  sentAt: true,
  createdAt: true,
});
export type InsertTicketScheduledNotification = z.infer<typeof insertTicketScheduledNotificationSchema>;
export type TicketScheduledNotification = typeof ticketScheduledNotificationsTable.$inferSelect;
