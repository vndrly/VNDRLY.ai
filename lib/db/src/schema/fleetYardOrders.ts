import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { fleetYardsTable } from "./fleetYards";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";

const time = (name: string) => timestamp(name, { withTimezone: true });
export type FleetYardFinding = { assetId: string; kind: "missing" | "damaged" | "substituted" | "unavailable" | "inspection"; note: string };

export const fleetYardOrdersTable = pgTable("fleet_yard_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull().references(() => vendorsTable.id),
  yardId: uuid("yard_id"),
  detailId: uuid("detail_id"),
  runId: uuid("run_id"),
  status: text("status").notNull().default("requested"),
  outcome: text("outcome"),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => usersTable.id),
  assignedToUserId: integer("assigned_to_user_id").references(() => usersTable.id),
  requestedAt: time("requested_at").notNull().defaultNow(),
  scheduledAt: time("scheduled_at"),
  startedAt: time("started_at"),
  reportedAt: time("reported_at"),
  requestedAssetIds: uuid("requested_asset_ids").array().notNull().default([]),
  actualAssetIds: uuid("actual_asset_ids").array().notNull().default([]),
  findings: jsonb("findings").$type<FleetYardFinding[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (t) => ({
  companyIdentity: unique("fleet_yard_orders_company_id_unique").on(t.companyId, t.id),
  companyStatus: index("fleet_yard_orders_company_status_idx").on(t.companyId, t.status),
  yardFk: foreignKey({ name: "fleet_yard_orders_yard_fk", columns: [t.companyId, t.yardId], foreignColumns: [fleetYardsTable.companyId, fleetYardsTable.id] }),
  versionCheck: check("fleet_yard_orders_version_check", sql`${t.version} > 0`),
  statusCheck: check("fleet_yard_orders_status_check", sql`${t.status} IN ('requested','assigned','in_progress','reported')`),
  reportCheck: check("fleet_yard_orders_report_check", sql`(${t.status} = 'reported' AND ${t.outcome} IS NOT NULL AND ${t.outcome} IN ('ready','needs_attention','unable_to_complete') AND ${t.reportedAt} IS NOT NULL) OR (${t.status} <> 'reported' AND ${t.outcome} IS NULL AND ${t.reportedAt} IS NULL)`),
  reportPresenceCheck: check("fleet_yard_orders_report_presence_check", sql`${t.status} <> 'reported' OR ${t.outcome} IS NOT NULL`),
  findingsCheck: check("fleet_yard_orders_findings_check", sql`jsonb_typeof(${t.findings}) = 'array' AND jsonb_array_length(${t.findings}) <= 100`),
}));

/** Assignment history is distinct from the order's current assignee. */
export const fleetYardOrderAssignmentsTable = pgTable("fleet_yard_order_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull().references(() => vendorsTable.id),
  orderId: uuid("order_id").notNull(),
  assignedToUserId: integer("assigned_to_user_id").notNull().references(() => usersTable.id),
  assignedByUserId: integer("assigned_by_user_id").notNull().references(() => usersTable.id),
  assignedAt: time("assigned_at").notNull().defaultNow(),
  endedAt: time("ended_at"),
}, (t) => ({
  orderFk: foreignKey({ name: "fleet_yard_order_assignments_order_fk", columns: [t.companyId, t.orderId], foreignColumns: [fleetYardOrdersTable.companyId, fleetYardOrdersTable.id] }),
  currentOrderUnique: uniqueIndex("fleet_yard_order_assignments_current_unique").on(t.companyId, t.orderId).where(sql`${t.endedAt} IS NULL`),
  timeCheck: check("fleet_yard_order_assignments_time_check", sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.assignedAt}`),
}));

/** Immutable decision log; the migration installs a write guard for updates and deletes. */
export const fleetYardOrderEventsTable = pgTable("fleet_yard_order_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull().references(() => vendorsTable.id),
  orderId: uuid("order_id").notNull(),
  operationId: uuid("operation_id").notNull(),
  actorUserId: integer("actor_user_id").notNull().references(() => usersTable.id),
  eventType: text("event_type").notNull(),
  orderVersion: integer("order_version").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: time("occurred_at").notNull().defaultNow(),
}, (t) => ({
  orderFk: foreignKey({ name: "fleet_yard_order_events_order_fk", columns: [t.companyId, t.orderId], foreignColumns: [fleetYardOrdersTable.companyId, fleetYardOrdersTable.id] }),
  operationUnique: uniqueIndex("fleet_yard_order_events_operation_unique").on(t.operationId),
  historyIdx: index("fleet_yard_order_events_history_idx").on(t.companyId, t.orderId, t.occurredAt),
  versionCheck: check("fleet_yard_order_events_version_check", sql`${t.orderVersion} > 0`),
  detailCheck: check("fleet_yard_order_events_detail_check", sql`jsonb_typeof(${t.detail}) = 'object' AND pg_column_size(${t.detail}) <= 32768`),
}));

export type FleetYardOrderRecord = typeof fleetYardOrdersTable.$inferSelect;
