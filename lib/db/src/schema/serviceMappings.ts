import { sql } from "drizzle-orm";
import { check, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { canonicalServicesTable } from "./canonicalServices";
import { vendorCapabilitiesTable } from "./vendorCapabilities";
import { workTypesTable } from "./workTypes";
import { usersTable } from "./users";

export const SERVICE_MAPPING_SUBJECT_TYPES = ["partner_work_type", "vendor_capability"] as const;
export const SERVICE_MAPPING_STATUSES = ["active", "review_required", "rejected", "superseded"] as const;
export type ServiceMappingSubjectType = typeof SERVICE_MAPPING_SUBJECT_TYPES[number];
export type ServiceMappingStatus = typeof SERVICE_MAPPING_STATUSES[number];

export const serviceMappingsTable = pgTable("service_mappings", {
  id: serial("id").primaryKey(),
  subjectType: text("subject_type", { enum: SERVICE_MAPPING_SUBJECT_TYPES }).notNull(),
  subjectId: integer("subject_id").notNull(),
  workTypeId: integer("work_type_id").references(() => workTypesTable.id),
  vendorCapabilityId: integer("vendor_capability_id").references(() => vendorCapabilitiesTable.id),
  // Novel-service proposals have no canonical concept until admin review.
  canonicalServiceId: integer("canonical_service_id").references(() => canonicalServicesTable.id),
  status: text("status", { enum: SERVICE_MAPPING_STATUSES }).notNull().default("review_required"),
  confidence: numeric("confidence", { precision: 6, scale: 5 }).notNull(),
  explanation: text("explanation").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  modelVersion: text("model_version").notNull(),
  mappingVersion: integer("mapping_version").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id),
  actorProcess: text("actor_process"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("service_mappings_current_active_unique").on(t.subjectType, t.subjectId)
    .where(sql`${t.status} = 'active' and ${t.supersededAt} is null`),
  uniqueIndex("service_mappings_subject_version_unique").on(t.subjectType, t.subjectId, t.mappingVersion),
  check("service_mappings_confidence_range", sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
  check("service_mappings_version_positive", sql`${t.mappingVersion} > 0`),
  check("service_mappings_status_valid", sql`${t.status} in (${sql.join(SERVICE_MAPPING_STATUSES.map((value) => sql.raw(`'${value}'`)), sql`, `)})`),
  check("service_mappings_active_has_concept", sql`${t.status} <> 'active' or (${t.canonicalServiceId} is not null and ${t.supersededAt} is null)`),
  check("service_mappings_subject_ownership", sql`(${t.subjectType} = 'partner_work_type' and ${t.workTypeId} is not null and ${t.workTypeId} = ${t.subjectId} and ${t.vendorCapabilityId} is null) or (${t.subjectType} = 'vendor_capability' and ${t.vendorCapabilityId} is not null and ${t.vendorCapabilityId} = ${t.subjectId} and ${t.workTypeId} is null)`),
]).enableRLS();

export type ServiceMapping = typeof serviceMappingsTable.$inferSelect;
