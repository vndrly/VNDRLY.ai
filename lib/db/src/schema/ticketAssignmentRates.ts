import { pgTable, serial, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { ticketsTable } from "./tickets";
import { vendorPeopleTable } from "./vendorPeople";

export const ticketAssignmentRatesTable = pgTable(
  "ticket_assignment_rates",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id),
    employeeId: integer("employee_id").notNull().references(() => vendorPeopleTable.id),
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }).notNull(),
    setById: integer("set_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqAssignment: uniqueIndex("uniq_ticket_assignment_rate").on(t.ticketId, t.employeeId),
  }),
);

export type TicketAssignmentRate = typeof ticketAssignmentRatesTable.$inferSelect;
