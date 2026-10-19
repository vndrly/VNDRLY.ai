import { boolean, pgTable, serial, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const CANONICAL_SERVICE_ALIAS_PROVENANCES = ["platform", "partner_usage", "vendor_usage", "reviewed_ai"] as const;

export const canonicalServicesTable = pgTable("canonical_services", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  definition: text("definition").notNull(),
  inclusionGuidance: text("inclusion_guidance"),
  exclusionGuidance: text("exclusion_guidance"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("canonical_services_code_unique").on(t.code)]).enableRLS();

export const canonicalServiceAliasesTable = pgTable("canonical_service_aliases", {
  id: serial("id").primaryKey(),
  canonicalServiceId: integer("canonical_service_id").notNull().references(() => canonicalServicesTable.id),
  alias: text("alias").notNull(),
  industry: text("industry"),
  region: text("region"),
  provenance: text("provenance", { enum: CANONICAL_SERVICE_ALIAS_PROVENANCES }).notNull().default("platform"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type CanonicalService = typeof canonicalServicesTable.$inferSelect;
export type CanonicalServiceAlias = typeof canonicalServiceAliasesTable.$inferSelect;
