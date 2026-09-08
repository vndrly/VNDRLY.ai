import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const workHubClientOperationsTable = pgTable("work_hub_client_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  commandKind: text("command_kind").notNull(),
  operationId: uuid("operation_id").notNull(),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ operationUnique: uniqueIndex("work_hub_client_operations_unique").on(t.userId, t.commandKind, t.operationId) }));

export const workHubAuditLogTable = pgTable("work_hub_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  priorVersion: integer("prior_version"),
  newVersion: integer("new_version"),
  source: text("source").notNull(),
  operationId: uuid("operation_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerCursorIdx: index("work_hub_audit_owner_cursor_idx").on(t.ownerOrgType, t.ownerOrgId, t.createdAt, t.id) }));
