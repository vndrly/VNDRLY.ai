import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const partnersTable = pgTable("partners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  physicalAddress: text("physical_address"),
  billingAddress: text("billing_address"),
  businessPhone: text("business_phone"),
  hoursOfOperation: text("hours_of_operation"),
  stateTaxId: text("state_tax_id"),
  federalTaxId: text("federal_tax_id"),
  blurb: text("blurb"),
  operatingRadiusMiles: integer("operating_radius_miles"),
  // The "main" logo. May be any aspect ratio (often a wide horizontal
  // wordmark). Used in modal headers and other places that have room for
  // an irregular/larger logo. Kept under the historical column name so
  // existing rows continue to work without backfill.
  logoUrl: text("logo_url"),
  // A square-cropped logo (e.g. 1:1 mark) used wherever the UI needs a
  // tightly-bounded badge — currently the navigation sidebar renders it
  // at 64x64. If null, callers should fall back to logoUrl so partners
  // who have only uploaded the original logo aren't visually downgraded.
  logoSquareUrl: text("logo_square_url"),
  brandPrimaryColor: text("brand_primary_color"),
  brandAccentColor: text("brand_accent_color"),
  // ── 1099 recipient e-delivery email customization ─────────────
  // Optional per-partner overrides for the subject and body of the
  // 1099 statement email (send1099RecipientEmail). When null/blank
  // the deliver endpoint falls back to the hardcoded English default
  // baked into sendgrid.ts. Both fields support the placeholders
  // {{vendorName}}, {{partnerName}}, {{taxYear}}, {{formType}},
  // {{formLabel}}, and {{totalReportable}} so partners can localize
  // (e.g. Spanish) and/or add their own AP contact info without
  // hand-editing per-vendor copy. Body is plain text — newlines are
  // preserved in the HTML render via white-space:pre-wrap and the
  // text part uses the body verbatim.
  email1099Subject: text("email_1099_subject"),
  email1099Body: text("email_1099_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Case-insensitive uniqueness on the trimmed display name. Mirrors
  // vendors_canonical_name_unique on the vendors table — same problem
  // shape: the Permian-Basin demo seed (and any future hand-edit) could
  // otherwise re-introduce duplicate "ExxonMobil" / "Chevron" rows that
  // would silently splinter site_locations, invoices, vendor_ratings,
  // user_org_memberships, etc. across two operator rows. Stored as an
  // expression index (not a generated column) so existing application
  // code that reads/writes `name` keeps the user's exact casing and
  // whitespace.
  uniqCanonicalName: uniqueIndex("partners_canonical_name_unique").on(
    sql`lower(btrim(${t.name}))`,
  ),
}));

export const insertPartnerSchema = createInsertSchema(partnersTable).omit({ id: true, createdAt: true });
export type InsertPartner = z.infer<typeof insertPartnerSchema>;
export type Partner = typeof partnersTable.$inferSelect;
