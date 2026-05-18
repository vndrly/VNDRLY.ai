import { pgTable, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { workTypesTable } from "./workTypes";
import { siteLocationsTable } from "./siteLocations";

export const workTypeSiteLocationsTable = pgTable(
  "work_type_site_locations",
  {
    workTypeId: integer("work_type_id")
      .notNull()
      .references(() => workTypesTable.id, { onDelete: "cascade" }),
    siteLocationId: integer("site_location_id")
      .notNull()
      .references(() => siteLocationsTable.id, { onDelete: "cascade" }),
  },
  (t) => ({
    workTypeSiteLocationUnique: uniqueIndex("work_type_site_location_unique").on(
      t.workTypeId,
      t.siteLocationId,
    ),
  }),
);
