import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";

/** A vendor may operate without a formal Yard; a home base is optional. */
export const fleetYardsTable = pgTable("fleet_yards", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull().references(() => vendorsTable.id),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(),
  destinationId: uuid("destination_id"),
  isHomeBase: boolean("is_home_base").notNull().default(false),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyIdentity: unique("fleet_yards_company_id_unique").on(t.companyId, t.id),
  companyLookup: index("fleet_yards_company_active_idx").on(t.companyId, t.active),
  oneHomeBase: uniqueIndex("fleet_yards_home_base_unique").on(t.companyId).where(sql`${t.isHomeBase} AND ${t.active}`),
  versionCheck: check("fleet_yards_version_check", sql`${t.version} > 0`),
}));

export type FleetYardRecord = typeof fleetYardsTable.$inferSelect;
