import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { gateStationsTable } from "./gateChangeOver";
import { notificationsTable } from "./notifications";
import { siteLocationsTable } from "./siteLocations";
import { usersTable } from "./users";
import { workHubShiftsTable } from "./workHubSchedule";

const time = (name: string) => timestamp(name, { withTimezone: true });

/** One episode survives reminders, severity changes, and shared acknowledgment. */
export const gateStaffingAlertsTable = pgTable(
  "gate_staffing_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    ownerOrgType: text("owner_org_type").notNull(),
    ownerOrgId: integer("owner_org_id").notNull(),
    siteId: integer("site_id")
      .notNull()
      .references(() => siteLocationsTable.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => gateStationsTable.id),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => workHubShiftsTable.id),
    status: text("status").notNull().default("open"),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    requiredCount: integer("required_count").notNull(),
    actualCount: integer("actual_count").notNull(),
    // A held episode never releases a backlog when a company is later resumed.
    notificationsPaused: boolean("notifications_paused")
      .notNull()
      .default(false),
    acknowledgedAt: time("acknowledged_at"),
    acknowledgedByUserId: integer("acknowledged_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    acknowledgedByName: text("acknowledged_by_name"),
    acknowledgedChannel: text("acknowledged_channel"),
    resolvedAt: time("resolved_at"),
    resolutionReason: text("resolution_reason"),
    lastNotifiedAt: time("last_notified_at"),
    escalatedAt: time("escalated_at"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: uniqueIndex("gate_staffing_alerts_code_unique").on(t.code),
    activeShiftUnique: uniqueIndex("gate_staffing_alerts_active_shift_unique")
      .on(t.shiftId)
      .where(sql`${t.resolvedAt} IS NULL`),
    ownerIdx: index("gate_staffing_alerts_owner_status_idx").on(
      t.ownerOrgType,
      t.ownerOrgId,
      t.status,
    ),
    stationIdx: index("gate_staffing_alerts_station_idx").on(
      t.stationId,
      t.resolvedAt,
    ),
    ownerCheck: check(
      "gate_staffing_alerts_owner_check",
      sql`${t.ownerOrgType} IN ('vendor','partner')`,
    ),
    statusCheck: check(
      "gate_staffing_alerts_status_check",
      sql`${t.status} IN ('open','acknowledged','resolved')`,
    ),
  }),
);

/** The canonical notification and this mapping are committed together. */
export const gateStaffingAlertNotificationsTable = pgTable(
  "gate_staffing_alert_notifications",
  {
    notificationId: integer("notification_id")
      .primaryKey()
      .references(() => notificationsTable.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => gateStaffingAlertsTable.id),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => ({
    alertIdx: index("gate_staffing_alert_notifications_alert_idx").on(
      t.alertId,
      t.userId,
    ),
  }),
);
