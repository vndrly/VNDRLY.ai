import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { siteLocationsTable } from "./siteLocations";
import { usersTable } from "./users";

export const capabilityFlagsTable = pgTable(
  "capability_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerOrgType: text("owner_org_type").notNull(),
    ownerOrgId: integer("owner_org_id").notNull(),
    siteId: integer("site_id").references(() => siteLocationsTable.id, {
      onDelete: "cascade",
    }),
    flagName: text("flag_name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    configuredByUserId: integer("configured_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerLookup: index("capability_flags_owner_lookup_idx").on(
      table.ownerOrgType,
      table.ownerOrgId,
      table.flagName,
    ),
    organizationFlagUnique: uniqueIndex("capability_flags_org_unique")
      .on(table.ownerOrgType, table.ownerOrgId, table.flagName)
      .where(sql`${table.siteId} is null`),
    siteFlagUnique: uniqueIndex("capability_flags_site_unique")
      .on(table.ownerOrgType, table.ownerOrgId, table.siteId, table.flagName)
      .where(sql`${table.siteId} is not null`),
  }),
);
