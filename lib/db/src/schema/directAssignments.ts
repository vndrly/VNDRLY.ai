import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { siteLocationsTable } from "./siteLocations";
import { usersTable } from "./users";

export const DIRECT_ASSIGNMENT_STATUSES = [
  "pending",
  "committed",
  "passed",
  "cancelled",
] as const;
export type DirectAssignmentStatus =
  (typeof DIRECT_ASSIGNMENT_STATUSES)[number];

export const directAssignmentsTable = pgTable(
  "direct_assignments",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    siteLocationId: integer("site_location_id")
      .notNull()
      .references(() => siteLocationsTable.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    scopeOfWork: text("scope_of_work"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status").notNull().default("pending"),
    passReason: text("pass_reason"),
    // Both audit columns are nullable so that hard-deleting a user does
    // not nuke the historical record. The application always sets them
    // on insert; only `ON DELETE SET NULL` from a future user delete can
    // make them null. Keeping them notNull would conflict with the
    // `set null` FK behavior and crash on user deletion.
    createdByUserId: integer("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    respondedByUserId: integer("responded_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    vendorStatusIdx: index("direct_assignments_vendor_status_idx").on(
      t.vendorId,
      t.status,
    ),
    partnerStatusIdx: index("direct_assignments_partner_status_idx").on(
      t.partnerId,
      t.status,
    ),
    siteIdx: index("direct_assignments_site_idx").on(t.siteLocationId),
    statusCheck: check(
      "direct_assignments_status_check",
      sql`${t.status} IN ('pending','committed','passed','cancelled')`,
    ),
  }),
);

export const insertDirectAssignmentSchema = createInsertSchema(
  directAssignmentsTable,
).omit({
  id: true,
  status: true,
  passReason: true,
  respondedByUserId: true,
  respondedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDirectAssignment = z.infer<
  typeof insertDirectAssignmentSchema
>;
export type DirectAssignment = typeof directAssignmentsTable.$inferSelect;
