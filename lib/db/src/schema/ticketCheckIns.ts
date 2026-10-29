import { pgTable, serial, integer, timestamp, doublePrecision, text, numeric, uuid, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ticketsTable } from "./tickets";
import { vendorPeopleTable } from "./vendorPeople";

import { gateStationsTable } from "./gateChangeOver";
import type { GateAssociationProvenance } from "./siteVisits";

export const ticketCheckInsTable = pgTable("ticket_check_ins", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => vendorPeopleTable.id, { onDelete: "cascade" }),
  gateStationId: uuid("gate_station_id").references(() => gateStationsTable.id),
  gateAssociationProvenance: jsonb("gate_association_provenance").$type<GateAssociationProvenance>(),
  checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull(),
  checkInLatitude: doublePrecision("check_in_latitude"),
  checkInLongitude: doublePrecision("check_in_longitude"),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  checkOutLatitude: doublePrecision("check_out_latitude"),
  checkOutLongitude: doublePrecision("check_out_longitude"),
  hourlyRateAtTime: numeric("hourly_rate_at_time", { precision: 8, scale: 2 }),
  source: text("source").notNull().default("manual"),
  correctedById: integer("corrected_by_id"),
  correctedReason: text("corrected_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketCheckInSchema = createInsertSchema(ticketCheckInsTable).omit({ id: true, createdAt: true, gateStationId: true, gateAssociationProvenance: true });
export type InsertTicketCheckIn = z.infer<typeof insertTicketCheckInSchema>;
export type TicketCheckIn = typeof ticketCheckInsTable.$inferSelect;
