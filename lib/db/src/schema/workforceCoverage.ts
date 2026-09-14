import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubShiftsTable } from "./workHubSchedule";

export const workforceStaffingRequirementsTable = pgTable("workforce_staffing_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  siteId: integer("site_id").notNull(),
  roleCode: text("role_code").notNull(),
  weekday: integer("weekday").notNull(),
  startsAtLocal: text("starts_at_local").notNull(),
  endsAtLocal: text("ends_at_local").notNull(),
  requiredCount: integer("required_count").notNull().default(1),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (table) => ({ ownerSiteIdx: index("workforce_staffing_requirement_owner_site_idx").on(table.ownerOrgType, table.ownerOrgId, table.siteId) }));

export const workforceCoverageRecordsTable = pgTable("workforce_coverage_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  shiftId: uuid("shift_id").notNull().references(() => workHubShiftsTable.id, { onDelete: "cascade" }),
  requirementId: uuid("requirement_id").references(() => workforceStaffingRequirementsTable.id),
  vacancyOrigin: text("vacancy_origin").notNull(),
  requiredCount: integer("required_count").notNull().default(1),
  assignedCount: integer("assigned_count").notNull().default(0),
  state: text("state").notNull().default("uncovered"),
  supervisorUserId: integer("supervisor_user_id").references(() => usersTable.id),
  escalationTargetUserId: integer("escalation_target_user_id").references(() => usersTable.id),
  escalationDueAt: timestamp("escalation_due_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ shiftUnique: uniqueIndex("workforce_coverage_shift_unique").on(table.shiftId), stateDueIdx: index("workforce_coverage_state_due_idx").on(table.state, table.escalationDueAt) }));

export const workforceAssignmentStatesTable = pgTable("workforce_assignment_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  shiftId: uuid("shift_id").notNull().references(() => workHubShiftsTable.id, { onDelete: "cascade" }),
  workerUserId: integer("worker_user_id").notNull().references(() => usersTable.id),
  state: text("state").notNull().default("pending"),
  acknowledgementDueAt: timestamp("acknowledgement_due_at", { withTimezone: true }).notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  reminderSchedule: jsonb("reminder_schedule").$type<Array<{ kind: string; at: string }>>().notNull().default([]),
  reminderReceipts: jsonb("reminder_receipts").$type<Array<{ kind: string; sentAt: string; acknowledgedAt?: string }>>().notNull().default([]),
  noShowAt: timestamp("no_show_at", { withTimezone: true }),
  warningSnapshot: jsonb("warning_snapshot").$type<string[]>().notNull().default([]),
  overrideReason: text("override_reason"),
  assignedById: integer("assigned_by_id").notNull().references(() => usersTable.id),
  operationId: uuid("operation_id").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ shiftWorkerUnique: uniqueIndex("workforce_assignment_state_shift_worker_unique").on(table.shiftId, table.workerUserId), operationUnique: uniqueIndex("workforce_assignment_state_operation_unique").on(table.operationId), pendingDueIdx: index("workforce_assignment_state_pending_due_idx").on(table.state, table.acknowledgementDueAt) }));
