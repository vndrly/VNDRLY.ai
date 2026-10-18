import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";
import { partnersTable } from "./partners";
import { workTypesTable } from "./workTypes";
import { usersTable } from "./users";

export const vendorCapabilitiesTable = pgTable("vendor_capabilities", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  defaultUnit: text("default_unit"),
  defaultRateCard: jsonb("default_rate_card").$type<Record<string, unknown>>(),
  capacity: integer("capacity").notNull().default(1),
  qualifications: jsonb("qualifications").$type<Record<string, unknown>>(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  active: boolean("active").notNull().default(true),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("vendor_capabilities_capacity_positive", sql`${t.capacity} > 0`)]).enableRLS();

// A null capability identifies a company default; a capability row overrides it.
export const vendorServiceAreasTable = pgTable("vendor_service_areas", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  vendorCapabilityId: integer("vendor_capability_id").references(() => vendorCapabilitiesTable.id),
  address: text("address").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  radiusMiles: numeric("radius_miles", { precision: 10, scale: 3 }).notNull(),
  coordinateProvenance: text("coordinate_provenance").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(true),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("vendor_service_areas_radius_positive", sql`${t.radiusMiles} > 0`),
  check("vendor_service_areas_coordinates_valid", sql`${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180 and not (${t.latitude} = 0 and ${t.longitude} = 0)`),
  check("vendor_service_areas_effective_order", sql`${t.effectiveUntil} is null or ${t.effectiveUntil} > ${t.effectiveFrom}`),
]).enableRLS();

export const vendorPartnerServiceOffersTable = pgTable("vendor_partner_service_offers", {
  id: serial("id").primaryKey(),
  vendorCapabilityId: integer("vendor_capability_id").notNull().references(() => vendorCapabilitiesTable.id),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id),
  workTypeId: integer("work_type_id").notNull().references(() => workTypesTable.id),
  // Historical identity, not a live reference: legacy selections are replaced
  // by catalog edits. Keep the original ID even after that selection is removed.
  sourceVendorWorkTypeId: integer("source_vendor_work_type_id"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  currency: text("currency").notNull().default("USD"),
  rateComponents: jsonb("rate_components").$type<Record<string, unknown>>(),
  notes: text("notes"),
  commercialConditions: text("commercial_conditions"),
  availability: jsonb("availability").$type<Record<string, unknown>>(),
  capacity: integer("capacity").notNull().default(1),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  createdById: integer("created_by_id").references(() => usersTable.id),
  updatedById: integer("updated_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("vendor_partner_service_offers_scope_unique").on(t.vendorCapabilityId, t.partnerId, t.workTypeId),
  check("vendor_partner_service_offers_capacity_positive", sql`${t.capacity} > 0`),
  check("vendor_partner_service_offers_price_nonnegative", sql`${t.unitPrice} >= 0`),
  check("vendor_partner_service_offers_version_positive", sql`${t.version} > 0`),
  check("vendor_partner_service_offers_effective_order", sql`${t.effectiveUntil} is null or ${t.effectiveUntil} > ${t.effectiveFrom}`),
]).enableRLS();

export type VendorCapability = typeof vendorCapabilitiesTable.$inferSelect;
export type VendorServiceArea = typeof vendorServiceAreasTable.$inferSelect;
export type VendorPartnerServiceOffer = typeof vendorPartnerServiceOffersTable.$inferSelect;
