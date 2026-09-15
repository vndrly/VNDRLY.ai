import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assetsTable } from "./assets";
import { siteLocationsTable } from "./siteLocations";
import { siteVisitsTable } from "./siteVisits";
import { usersTable } from "./users";
import { workHubShiftsTable } from "./workHubSchedule";

export const fieldTripsTable = pgTable("field_trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  operationId: uuid("operation_id").notNull(),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  driverUserId: integer("driver_user_id").notNull().references(() => usersTable.id),
  vehicleAssetId: uuid("vehicle_asset_id").references(() => assetsTable.id),
  assignmentId: text("assignment_id"),
  siteLocationId: integer("site_location_id").notNull().references(() => siteLocationsTable.id),
  destinationSource: text("destination_source").notNull(),
  activeShiftId: uuid("active_shift_id").references(() => workHubShiftsTable.id),
  trackingState: text("tracking_state").notNull().default("active"),
  presenceState: text("presence_state").notNull().default("en_route"),
  lastLatitude: doublePrecision("last_latitude"),
  lastLongitude: doublePrecision("last_longitude"),
  lastAccuracyMeters: doublePrecision("last_accuracy_meters"),
  lastSpeedMps: doublePrecision("last_speed_mps"),
  lastRecordedAt: timestamp("last_recorded_at", { withTimezone: true }),
  lastPointReliable: boolean("last_point_reliable").notNull().default(false),
  crossingCandidate: jsonb("crossing_candidate").$type<{ direction: "entry" | "exit"; crossedAt: string } | null>(),
  finalVisitId: integer("final_visit_id").references(() => siteVisitsTable.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completionOperationId: uuid("completion_operation_id"),
  completionReason: text("completion_reason"),
  completedByUserId: integer("completed_by_user_id").references(() => usersTable.id),
  needsSupervisorConfirmation: boolean("needs_supervisor_confirmation").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  operationUnique: uniqueIndex("field_trip_operation_unique").on(table.operationId),
  activeDriverIdx: index("field_trip_active_driver_idx").on(table.driverUserId, table.trackingState),
  ownerSiteIdx: index("field_trip_owner_site_idx").on(table.ownerOrgType, table.ownerOrgId, table.siteLocationId),
}));

export const fieldTripLocationPointsTable = pgTable("field_trip_location_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull().references(() => fieldTripsTable.id, { onDelete: "cascade" }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  accuracyMeters: doublePrecision("accuracy_meters").notNull(),
  speedMps: doublePrecision("speed_mps"),
  distanceToSiteMeters: doublePrecision("distance_to_site_meters"),
  reliable: boolean("reliable").notNull().default(true),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ tripTimeIdx: index("field_trip_point_trip_time_idx").on(table.tripId, table.recordedAt) }));

export const fieldTripCrossingsTable = pgTable("field_trip_crossings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull().references(() => fieldTripsTable.id, { onDelete: "cascade" }),
  siteLocationId: integer("site_location_id").notNull().references(() => siteLocationsTable.id),
  direction: text("direction").notNull(),
  crossedAt: timestamp("crossed_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  visitId: integer("visit_id").references(() => siteVisitsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ dedupeUnique: uniqueIndex("field_trip_crossing_dedupe_unique").on(table.dedupeKey) }));
