import { pgTable, serial, integer, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { siteLocationsTable } from "./siteLocations";

export const vendorSiteLocationAfesTable = pgTable(
  "vendor_site_location_afes",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    siteLocationId: integer("site_location_id")
      .notNull()
      .references(() => siteLocationsTable.id, { onDelete: "cascade" }),
    afe: text("afe").notNull(),
  },
  (t) => ({
    vendorSiteLocationUnique: uniqueIndex(
      "vendor_site_location_afe_unique",
    ).on(t.vendorId, t.siteLocationId),
  }),
);

export const insertVendorSiteLocationAfeSchema = createInsertSchema(
  vendorSiteLocationAfesTable,
).omit({ id: true });
export type InsertVendorSiteLocationAfe = z.infer<
  typeof insertVendorSiteLocationAfeSchema
>;
export type VendorSiteLocationAfe =
  typeof vendorSiteLocationAfesTable.$inferSelect;
