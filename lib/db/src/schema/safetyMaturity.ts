import { pgTable, text, integer, jsonb, primaryKey } from "drizzle-orm/pg-core";
export const safetyMaturityAssessmentsTable = pgTable("safety_maturity_assessments", {
  orgType: text("org_type").notNull(),
  orgId: integer("org_id").notNull(),
  assessment: jsonb("assessment").notNull(),
}, table => [primaryKey({ columns: [table.orgType, table.orgId] })]);
