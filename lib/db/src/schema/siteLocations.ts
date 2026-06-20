import { pgTable, text, serial, timestamp, integer, doublePrecision, boolean, uniqueIndex, numeric } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";

export const siteLocationsTable = pgTable("site_locations", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  state: text("state"),
  siteCode: text("site_code").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  status: text("status").notNull().default("active"),
  hidden: boolean("hidden").notNull().default(false),
  siteRadiusMeters: integer("site_radius_meters"),
  afe: text("afe"),
  photoUrl: text("photo_url"),
  // Resolved from lat/lng at create/update via situs lookup + state rubric.
  taxJurisdictionPostalCode: text("tax_jurisdiction_postal_code"),
  taxJurisdictionCounty: text("tax_jurisdiction_county"),
  taxJurisdictionCity: text("tax_jurisdiction_city"),
  taxJurisdictionLabel: text("tax_jurisdiction_label"),
  stateTaxRate: numeric("state_tax_rate", { precision: 6, scale: 4 }),
  localTaxRate: numeric("local_tax_rate", { precision: 6, scale: 4 }),
  combinedTaxRate: numeric("combined_tax_rate", { precision: 6, scale: 4 }),
  // Legacy aliases kept in sync: merchandise=combined, labor=state (informational).
  merchandiseTaxRate: numeric("merchandise_tax_rate", { precision: 6, scale: 4 }),
  laborTaxRate: numeric("labor_tax_rate", { precision: 6, scale: 4 }),
  taxJurisdictionResolvedAt: timestamp("tax_jurisdiction_resolved_at", { withTimezone: true }),
  taxProvider: text("tax_provider"),
  // Provenance for sites populated by an automated pipeline (RRC, OCC,
  // FracTracker, manual entry, county-area aggregate, etc).
  // Values: 'manual' (default), 'area-anchor', 'rrc', 'occ'.
  sourceType: text("source_type").notNull().default("manual"),
  // External reference for the source row (e.g. RRC/OCC well API number).
  sourceRef: text("source_ref"),
  // Set when this row has been replaced by a more specific one
  // (e.g. county-level area anchor superseded by individual well/pad rows).
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // DB-level idempotency for the RRC/OCC ingest pipeline: a given
  // (partner, external well reference) pair must be unique. Partial
  // index so manual / area-anchor rows (sourceRef IS NULL) are unaffected.
  partnerSourceRefUniq: uniqueIndex("site_locations_partner_source_ref_uniq")
    .on(t.partnerId, t.sourceRef)
    .where(sql`${t.sourceRef} IS NOT NULL`),
}));

export const insertSiteLocationSchema = createInsertSchema(siteLocationsTable).omit({ id: true, siteCode: true, isActive: true, status: true, createdAt: true });
export type InsertSiteLocation = z.infer<typeof insertSiteLocationSchema>;
export type SiteLocation = typeof siteLocationsTable.$inferSelect;
