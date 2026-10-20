import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid, doublePrecision } from "drizzle-orm/pg-core";
import { assetsTable } from "./assets";
import { fleetYardsTable } from "./fleetYards";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";

const time = (name: string) => timestamp(name, { withTimezone: true });
const fields = {
  companyId: integer("company_id").notNull().references(() => vendorsTable.id),
  assetId: uuid("asset_id").notNull().references(() => assetsTable.id),
  state: text("state").notNull(),
  method: text("method").notNull(),
  observedAt: time("observed_at").notNull().defaultNow(),
  observedByUserId: integer("observed_by_user_id").notNull().references(() => usersTable.id),
  yardId: uuid("yard_id"),
  runId: uuid("run_id"),
  detailId: uuid("detail_id"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  notes: text("notes").notNull().default(""),
};

/** One current observation per asset; appending history does not replace the asset's native custody audit. */
export const fleetAssetCustodyTable = pgTable("fleet_asset_custody", {
  id: uuid("id").primaryKey().defaultRandom(),
  ...fields,
  version: integer("version").notNull().default(1),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (t) => ({
  companyAssetUnique: unique("fleet_asset_custody_company_asset_unique").on(t.companyId, t.assetId),
  assetUnique: unique("fleet_asset_custody_asset_unique").on(t.assetId),
  companyState: index("fleet_asset_custody_company_state_idx").on(t.companyId, t.state),
  yardFk: foreignKey({ name: "fleet_asset_custody_yard_fk", columns: [t.companyId, t.yardId], foreignColumns: [fleetYardsTable.companyId, fleetYardsTable.id] }),
  versionCheck: check("fleet_asset_custody_version_check", sql`${t.version} > 0`),
  stateCheck: check("fleet_asset_custody_state_check", sql`${t.state} IN ('intake','at_yard','reserved','attached','in_transit','returned','transferred')`),
  methodCheck: check("fleet_asset_custody_method_check", sql`${t.method} IN ('gate_scan','gps_geofence','manual','driver_app')`),
  coordinatesCheck: check("fleet_asset_custody_coordinates_check", sql`(${t.latitude} IS NULL AND ${t.longitude} IS NULL) OR (${t.latitude} IS NOT NULL AND ${t.longitude} IS NOT NULL AND ${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180)`),
  coordinatesPairCheck: check("fleet_asset_custody_coordinates_pair_check", sql`(${t.latitude} IS NULL) = (${t.longitude} IS NULL)`),
}));

/** Canonical immutable observation receipt for offline and unknown-result replay. */
export const fleetAssetCustodyEventsTable = pgTable("fleet_asset_custody_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  operationId: uuid("operation_id").notNull(),
  ...fields,
  assetVersion: integer("asset_version").notNull().default(1),
  occurredAt: time("occurred_at").notNull().defaultNow(),
}, (t) => ({
  custodyFk: foreignKey({ name: "fleet_asset_custody_events_current_fk", columns: [t.companyId, t.assetId], foreignColumns: [fleetAssetCustodyTable.companyId, fleetAssetCustodyTable.assetId] }),
  yardFk: foreignKey({ name: "fleet_asset_custody_events_yard_fk", columns: [t.companyId, t.yardId], foreignColumns: [fleetYardsTable.companyId, fleetYardsTable.id] }),
  operationUnique: uniqueIndex("fleet_asset_custody_events_operation_unique").on(t.operationId),
  historyIdx: index("fleet_asset_custody_events_history_idx").on(t.companyId, t.assetId, t.occurredAt),
  versionCheck: check("fleet_asset_custody_events_version_check", sql`${t.assetVersion} > 0`),
  stateCheck: check("fleet_asset_custody_events_state_check", sql`${t.state} IN ('intake','at_yard','reserved','attached','in_transit','returned','transferred')`),
  methodCheck: check("fleet_asset_custody_events_method_check", sql`${t.method} IN ('gate_scan','gps_geofence','manual','driver_app')`),
  coordinatesCheck: check("fleet_asset_custody_events_coordinates_check", sql`(${t.latitude} IS NULL AND ${t.longitude} IS NULL) OR (${t.latitude} IS NOT NULL AND ${t.longitude} IS NOT NULL AND ${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180)`),
  coordinatesPairCheck: check("fleet_asset_custody_events_coordinates_pair_check", sql`(${t.latitude} IS NULL) = (${t.longitude} IS NULL)`),
}));

export type FleetAssetCustodyRecord = typeof fleetAssetCustodyTable.$inferSelect;
