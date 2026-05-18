import { pgTable, serial, integer, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { siteLocationsTable } from "./siteLocations";
import { workTypesTable } from "./workTypes";
import { vendorsTable } from "./vendors";

export const siteWorkAssignmentsTable = pgTable(
  "site_work_assignments",
  {
    id: serial("id").primaryKey(),
    siteLocationId: integer("site_location_id").notNull().references(() => siteLocationsTable.id),
    workTypeId: integer("work_type_id").notNull().references(() => workTypesTable.id),
    vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
    afe: text("afe"),
  },
  (t) => ({
    // A vendor may only be pinned to a given (site_location, work_type)
    // once. Prior to this constraint the schema allowed multiple rows for
    // the same triplet, which let an admin attach more than one AFE to a
    // single site location for the same work type. The AFE join used by
    // tickets and invoice generation expects exactly one row per triplet.
    vendorWorkTypeSiteUnique: uniqueIndex(
      "site_work_assignments_vendor_work_type_site_unique",
    ).on(t.vendorId, t.workTypeId, t.siteLocationId),
  }),
);

export const insertSiteWorkAssignmentSchema = createInsertSchema(siteWorkAssignmentsTable).omit({ id: true });
export type InsertSiteWorkAssignment = z.infer<typeof insertSiteWorkAssignmentSchema>;
export type SiteWorkAssignment = typeof siteWorkAssignmentsTable.$inferSelect;
