import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { hotlistJobsTable } from "./hotlistJobs";
import { vendorsTable } from "./vendors";

export const hotlistBidsTable = pgTable("hotlist_bids", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => hotlistJobsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 2 }).notNull(),
  etaDays: integer("eta_days"),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HotlistBid = typeof hotlistBidsTable.$inferSelect;
