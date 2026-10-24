import {
  pgTable,
  uuid,
  integer,
  text,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";
import { siteLocationsTable } from "./siteLocations";
import { gateStationsTable } from "./gateChangeOver";
import {
  workHubShiftsTable,
  workHubShiftRequestsTable,
} from "./workHubSchedule";
export const workforceCoverageResolutionsTable = pgTable(
  "workforce_coverage_resolutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id),
    siteId: integer("site_id")
      .notNull()
      .references(() => siteLocationsTable.id),
    gateStationId: uuid("gate_station_id")
      .notNull()
      .references(() => gateStationsTable.id),
    anchorShiftId: uuid("anchor_shift_id")
      .notNull()
      .references(() => workHubShiftsTable.id),
    originalUserId: integer("original_user_id").references(() => usersTable.id),
    replacementUserId: integer("replacement_user_id")
      .notNull()
      .references(() => usersTable.id),
    kind: text("kind").notNull(),
    effectiveDate: date("effective_date").notNull(),
    weekday: integer("weekday").notNull(),
    startsAtLocal: text("starts_at_local").notNull(),
    endsAtLocal: text("ends_at_local").notNull(),
    timezone: text("timezone").notNull(),
    requestId: uuid("request_id").references(
      () => workHubShiftRequestsTable.id,
    ),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => usersTable.id),
    operationId: uuid("operation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    validKind:check("workforce_coverage_resolutions_kind_check",sql`${t.kind} IN ('temporary','permanent')`),
    validWeekday:check("workforce_coverage_resolutions_weekday_check",sql`${t.weekday} BETWEEN 0 AND 6`),
    operationUnique: uniqueIndex(
      "workforce_coverage_resolutions_operation_id_key",
    ).on(t.operationId),
    lookup: index("workforce_coverage_resolution_lookup").on(
      t.vendorId,
      t.siteId,
      t.gateStationId,
      t.effectiveDate,
    ),
  }),
);
