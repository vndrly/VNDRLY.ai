import { pgTable, serial, integer, doublePrecision, real, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ticketsTable } from "./tickets";

export const gpsLogsTable = pgTable("gps_logs", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  eventType: text("event_type").notNull(),
  batteryLevel: real("battery_level"),
  // Ground speed in meters per second as reported by the device GPS. Null
  // when the device couldn't measure it (cold fix, walking indoors, sim).
  speedMps: real("speed_mps"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGpsLogSchema = createInsertSchema(gpsLogsTable).omit({ id: true, recordedAt: true });
export type InsertGpsLog = z.infer<typeof insertGpsLogSchema>;
export type GpsLog = typeof gpsLogsTable.$inferSelect;
