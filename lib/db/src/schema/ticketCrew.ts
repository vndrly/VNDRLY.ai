import { sql } from "drizzle-orm";
import { pgTable, serial, integer, timestamp, uniqueIndex, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ticketsTable } from "./tickets";
import { vendorPeopleTable } from "./vendorPeople";
import { usersTable } from "./users";

export const ticketCrewTable = pgTable(
  "ticket_crew",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => vendorPeopleTable.id, { onDelete: "cascade" }),
    addedByUserId: integer("added_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: integer("removed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    ackStatus: text("ack_status").notNull().default("pending"),
    ackAt: timestamp("ack_at", { withTimezone: true }),
    ackNote: text("ack_note"),
    enRouteRemindSentAt: timestamp("en_route_remind_sent_at", { withTimezone: true }),
  },
  (table) => ({
    ticketEmployeeActiveIdx: uniqueIndex("ticket_crew_ticket_employee_active_idx")
      .on(table.ticketId, table.employeeId)
      .where(sql`removed_at IS NULL`),
  }),
);

export const insertTicketCrewSchema = createInsertSchema(ticketCrewTable).omit({
  id: true,
  addedAt: true,
  removedAt: true,
  removedByUserId: true,
});
export type InsertTicketCrew = z.infer<typeof insertTicketCrewSchema>;
export type TicketCrew = typeof ticketCrewTable.$inferSelect;
