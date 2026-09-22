import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { gateStationsTable } from "./gateChangeOver";
import { siteLocationsTable } from "./siteLocations";
import { usersTable } from "./users";
import { workHubChannelsTable } from "./workHubChannels";

const time = (name: string) => timestamp(name, { withTimezone: true });

export const workHubAvailabilityTable = pgTable("work_hub_availability", {
  id: uuid("id").primaryKey().defaultRandom(), ownerOrgType: text("owner_org_type").notNull(), ownerOrgId: integer("owner_org_id").notNull(), userId: integer("user_id").notNull().references(() => usersTable.id), startsAt: time("starts_at").notNull(), endsAt: time("ends_at").notNull(), available: boolean("available").notNull().default(true), recurrence: jsonb("recurrence").$type<Record<string, unknown>>(), createdAt: time("created_at").notNull().defaultNow(),
}, (t) => ({ userTimeIdx: index("work_hub_availability_user_time_idx").on(t.userId, t.startsAt, t.endsAt) }));

export const workHubShiftsTable = pgTable("work_hub_shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  channelId: uuid("channel_id").references(() => workHubChannelsTable.id),
  title: text("title").notNull(),
  startsAt: time("starts_at").notNull(),
  endsAt: time("ends_at").notNull(),
  timezone: text("timezone").notNull(),
  open: boolean("open").notNull().default(false),
  qualificationCodes: text("qualification_codes").array(),
  recurrence: jsonb("recurrence").$type<Record<string, unknown>>(),
  calendarType: text("calendar_type").notNull().default("company"),
  projectName: text("project_name"),
  milestoneStatus: text("milestone_status").notNull().default("upcoming"),
  percentComplete: integer("percent_complete").notNull().default(0),
  instructions: text("instructions"),
  dependencyTitle: text("dependency_title"),
  blockers: text("blockers"),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id),
  afeCode: text("afe_code"),
  ticketNumber: text("ticket_number"),
  budgetAmount: numeric("budget_amount", { precision: 14, scale: 2 }),
  budgetUsedAmount: numeric("budget_used_amount", { precision: 14, scale: 2 }),
  invoicedAmount: numeric("invoiced_amount", { precision: 14, scale: 2 }),
  invoiceReference: text("invoice_reference"),
  sharedWithUserIds: jsonb("shared_with_user_ids").$type<number[]>().notNull().default([]),
  siteLocationId: integer("site_location_id").references(() => siteLocationsTable.id),
  gateStationId: uuid("gate_station_id").references(() => gateStationsTable.id),
  requiredStaffCount: integer("required_staff_count"),
  workStartPolicy: text("work_start_policy"),
  version: integer("version").notNull().default(1),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (t) => ({
  ownerTimeIdx: index("work_hub_shifts_owner_time_idx").on(t.ownerOrgType, t.ownerOrgId, t.startsAt),
  gateTimeIdx: index("work_hub_shifts_gate_time_idx").on(t.gateStationId, t.startsAt, t.endsAt),
}));

export const workHubShiftAssignmentsTable = pgTable("work_hub_shift_assignments", {
  id: uuid("id").primaryKey().defaultRandom(), shiftId: uuid("shift_id").notNull().references(() => workHubShiftsTable.id, { onDelete: "cascade" }), userId: integer("user_id").notNull().references(() => usersTable.id), status: text("status").notNull().default("assigned"), warningSnapshot: jsonb("warning_snapshot").$type<unknown[]>(), assignedById: integer("assigned_by_id").references(() => usersTable.id), createdAt: time("created_at").notNull().defaultNow(),
}, (t) => ({ uniqueAssignment: uniqueIndex("work_hub_shift_assignment_unique").on(t.shiftId, t.userId) }));

export const workHubShiftRequestsTable = pgTable("work_hub_shift_requests", {
  id: uuid("id").primaryKey().defaultRandom(), shiftId: uuid("shift_id").notNull().references(() => workHubShiftsTable.id, { onDelete: "cascade" }), requestType: text("request_type").notNull(), requestedById: integer("requested_by_id").notNull().references(() => usersTable.id), targetUserId: integer("target_user_id").references(() => usersTable.id), status: text("status").notNull().default("pending"), warningSnapshot: jsonb("warning_snapshot").$type<unknown[]>(), decidedById: integer("decided_by_id").references(() => usersTable.id), decidedAt: time("decided_at"), createdAt: time("created_at").notNull().defaultNow(),
});
