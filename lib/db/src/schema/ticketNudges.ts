import { pgTable, serial, timestamp, integer, text, index } from "drizzle-orm/pg-core";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

export const ticketNudgesTable = pgTable(
  "ticket_nudges",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    actorUserId: integer("actor_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    actorRole: text("actor_role").notNull(),
    direction: text("direction").notNull(),
    targetTier: text("target_tier").notNull(),
    message: text("message"),
    ticketStatus: text("ticket_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ticketActorIdx: index("ticket_nudges_ticket_actor_idx").on(
      t.ticketId,
      t.actorUserId,
      t.direction,
      t.createdAt,
    ),
  }),
);

export type TicketNudgeRow = typeof ticketNudgesTable.$inferSelect;
export type InsertTicketNudge = typeof ticketNudgesTable.$inferInsert;
