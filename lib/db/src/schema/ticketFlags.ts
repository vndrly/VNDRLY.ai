import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

export const ticketFlagsTable = pgTable(
  "ticket_flags",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    flaggedByUserId: integer("flagged_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    actorRole: text("actor_role").notNull(),
    reason: text("reason"),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    clearedByUserId: integer("cleared_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketActiveIdx: index("ticket_flags_ticket_active_idx").on(t.ticketId, t.clearedAt),
  }),
);

export type TicketFlagRow = typeof ticketFlagsTable.$inferSelect;
export type InsertTicketFlag = typeof ticketFlagsTable.$inferInsert;
