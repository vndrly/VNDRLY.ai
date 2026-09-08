import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const workHubRetentionPoliciesTable = pgTable("work_hub_retention_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  policyVersion: integer("policy_version").notNull().default(1),
  rules: jsonb("rules").$type<Record<string, number>>().notNull(),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerVersionUnique: uniqueIndex("work_hub_retention_policy_unique").on(t.ownerOrgType, t.ownerOrgId, t.policyVersion) }));

export const workHubLegalHoldsTable = pgTable("work_hub_legal_holds", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  reason: text("reason").notNull(),
  active: boolean("active").notNull().default(true),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  releasedById: integer("released_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, (t) => ({ ownerSubjectIdx: index("work_hub_legal_holds_subject_idx").on(t.ownerOrgType, t.ownerOrgId, t.subjectType, t.subjectId) }));
