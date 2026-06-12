import { pgTable, text, serial, timestamp, integer, doublePrecision, date } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { workTypesTable } from "./workTypes";

export const hotlistJobsTable = pgTable("hotlist_jobs", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
  workTypeId: integer("work_type_id").references(() => workTypesTable.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  description: text("description"),
  locationAddress: text("location_address").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  deadline: date("deadline"),
  estimatedDurationDays: integer("estimated_duration_days"),
  status: text("status").notNull().default("open"),
  awardedBidId: integer("awarded_bid_id"),
  awardedVendorId: integer("awarded_vendor_id"),
  // Set when the partner converts an awarded bid into an actual ticket
  // via /api/hotlist/jobs/:id/convert. Acts as the gate the UI uses to
  // hide the "Create Ticket" button after a job has already produced a
  // ticket, and gives downstream views a direct link to the resulting
  // ticket (no intentional FK — tickets may be deleted/archived
  // independently of the historical hotlist record).
  convertedTicketId: integer("converted_ticket_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type HotlistJob = typeof hotlistJobsTable.$inferSelect;
