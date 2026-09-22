import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { gateShiftsTable, gateStationsTable } from "./gateChangeOver";
import { siteVisitsTable } from "./siteVisits";
import { usersTable } from "./users";
import { workHubShiftsTable } from "./workHubSchedule";

const time = (name: string) => timestamp(name, { withTimezone: true });

export type GateWorkStartPolicy = "on_site" | "paid_travel";
export type GateCoverageMode =
  | "active"
  | "paused_until"
  | "paused_indefinitely"
  | "closed";
export type GateAttendanceDisposition = "no_show" | "excused" | "reassigned";

export const gateWorkSessionsTable = pgTable("gate_work_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  workHubShiftId: uuid("work_hub_shift_id").references(() => workHubShiftsTable.id),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  startPolicy: text("start_policy").notNull(),
  travelStatus: text("travel_status").notNull().default("not_started"),
  etaAt: time("eta_at"),
  etaSource: text("eta_source"),
  locationSharingActive: boolean("location_sharing_active").notNull().default(false),
  trackingStatus: text("tracking_status").notNull().default("not_required"),
  trackingExceptionReason: text("tracking_exception_reason"),
  startedAt: time("started_at").notNull().defaultNow(),
  arrivedAt: time("arrived_at"),
  endedAt: time("ended_at"),
  startLatitude: doublePrecision("start_latitude"),
  startLongitude: doublePrecision("start_longitude"),
  source: text("source").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => ({
  userActiveIdx: index("gate_work_sessions_user_active_idx").on(t.userId, t.endedAt),
  shiftIdx: index("gate_work_sessions_shift_idx").on(t.workHubShiftId, t.startedAt),
}));

export const gateDutySessionsTable = pgTable("gate_duty_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  stationId: uuid("station_id").notNull().references(() => gateStationsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  workHubShiftId: uuid("work_hub_shift_id").references(() => workHubShiftsTable.id),
  workSessionId: uuid("work_session_id").references(() => gateWorkSessionsTable.id),
  sourceLegacyShiftId: uuid("source_legacy_shift_id").unique().references(() => gateShiftsTable.id),
  startedAt: time("started_at").notNull().defaultNow(),
  endedAt: time("ended_at"),
  endedByUserId: integer("ended_by_user_id").references(() => usersTable.id),
  endReason: text("end_reason"),
  source: text("source").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => ({
  stationActiveIdx: index("gate_duty_sessions_station_active_idx").on(t.stationId, t.endedAt),
  userActiveUnique: uniqueIndex("gate_duty_sessions_user_station_active_unique")
    .on(t.stationId, t.userId)
    .where(sql`${t.endedAt} IS NULL`),
}));

export const gateAttendanceExceptionsTable = pgTable("gate_attendance_exceptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workHubShiftId: uuid("work_hub_shift_id").notNull().references(() => workHubShiftsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  state: text("state").notNull().default("unresolved"),
  disposition: text("disposition"),
  reason: text("reason"),
  resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id),
  detectedAt: time("detected_at").notNull().defaultNow(),
  resolvedAt: time("resolved_at"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (t) => ({
  shiftUserUnique: uniqueIndex("gate_attendance_exceptions_shift_user_unique").on(t.workHubShiftId, t.userId),
  unresolvedIdx: index("gate_attendance_exceptions_unresolved_idx").on(t.state, t.detectedAt),
}));

export const gateCoverageStatusTable = pgTable("gate_coverage_status", {
  stationId: uuid("station_id").primaryKey().references(() => gateStationsTable.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("active"),
  pausedUntil: time("paused_until"),
  reason: text("reason"),
  changedByUserId: integer("changed_by_user_id").notNull().references(() => usersTable.id),
  changedAt: time("changed_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const gateVisitReconciliationsTable = pgTable("gate_visit_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: integer("visit_id").notNull().references(() => siteVisitsTable.id),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  actorUserId: integer("actor_user_id").notNull().references(() => usersTable.id),
  reversesReconciliationId: uuid("reverses_reconciliation_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => ({
  visitTimeIdx: index("gate_visit_reconciliations_visit_time_idx").on(t.visitId, t.createdAt),
}));

export const gateReportDeliveriesTable = pgTable("gate_report_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id),
  recipientUserId: integer("recipient_user_id").notNull().references(() => usersTable.id),
  reportKind: text("report_kind").notNull(),
  format: text("format").notNull(),
  filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
  recipientScope: jsonb("recipient_scope").$type<Record<string, unknown>>().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  deliveryKey: text("delivery_key").notNull().unique(),
  expiresAt: time("expires_at").notNull(),
  sentAt: time("sent_at"),
  openedAt: time("opened_at"),
  revokedAt: time("revoked_at"),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => ({
  recipientTimeIdx: index("gate_report_deliveries_recipient_time_idx").on(t.recipientUserId, t.createdAt),
}));
