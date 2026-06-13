import { pgTable, text, serial, timestamp, integer, doublePrecision, numeric, jsonb, boolean, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const vendorsTable = pgTable("vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  physicalAddress: text("physical_address"),
  billingAddress: text("billing_address"),
  operatingRadiusMiles: integer("operating_radius_miles"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  geocodedAt: timestamp("geocoded_at", { withTimezone: true }),
  stateTaxId: text("state_tax_id"),
  federalTaxId: text("federal_tax_id"),
  businessPhone: text("business_phone"),
  hoursOfOperation: text("hours_of_operation"),
  blurb: text("blurb"),
  // The "main" logo. May be any aspect ratio (often a wide horizontal
  // wordmark). Used in modal headers and other places that have room for
  // an irregular/larger logo.
  logoUrl: text("logo_url"),
  // A square-cropped logo (e.g. 1:1 mark) used wherever the UI needs a
  // tightly-bounded badge — currently the navigation sidebar renders it
  // at 64x64. If null, callers should fall back to logoUrl so vendors
  // who have only uploaded the original logo aren't visually downgraded.
  // Mirrors partners.logo_square_url for parity across org types.
  logoSquareUrl: text("logo_square_url"),
  brandPrimaryColor: text("brand_primary_color"),
  brandAccentColor: text("brand_accent_color"),
  // Overtime configuration. NULL = use system defaults (8/40, 1.5×).
  // overtimeMultiplier defaults to 1.50 in invoice generation when null.
  dailyOtHours: numeric("daily_ot_hours", { precision: 5, scale: 2 }),
  weeklyOtHours: numeric("weekly_ot_hours", { precision: 5, scale: 2 }),
  overtimeMultiplier: numeric("overtime_multiplier", { precision: 4, scale: 2 }),
  // Compliance / Certificate of Insurance. Captured during the vendor
  // onboarding wizard's "Compliance" step and used by partner-facing
  // expiration reports. Document URL points at a private object-storage
  // entry that requires a signed download URL to view.
  insuranceCarrier: text("insurance_carrier"),
  insurancePolicyNumber: text("insurance_policy_number"),
  insuranceExpirationDate: text("insurance_expiration_date"),
  coiDocumentUrl: text("coi_document_url"),
  // Workers' Compensation policy. Tracked separately from the COI
  // (general liability) above so the approval-derivation engine can
  // surface a precise lapse reason ("WC expired" vs "COI expired") on
  // the partner-facing re-approval banner. Optional at vendor-creation
  // time but the catalog `publish` endpoint refuses to cut a new
  // version when any of the three insurance buckets is incomplete.
  wcCarrier: text("wc_carrier"),
  wcPolicyNumber: text("wc_policy_number"),
  wcExpirationDate: text("wc_expiration_date"),
  wcDocumentUrl: text("wc_document_url"),
  // General Liability — distinct policy from the COI snapshot above.
  // Some carriers issue a single COI that covers GL + auto + WC, but
  // the partner-side renewal calendar needs them split out.
  glCarrier: text("gl_carrier"),
  glPolicyNumber: text("gl_policy_number"),
  glExpirationDate: text("gl_expiration_date"),
  glDocumentUrl: text("gl_document_url"),
  // Auto liability. Several partner master service agreements (Halliburton,
  // ConocoPhillips) require auto coverage be tracked separately from
  // GL because the certificate-of-insurance audit teams demand it.
  autoLiabilityCarrier: text("auto_liability_carrier"),
  autoLiabilityPolicyNumber: text("auto_liability_policy_number"),
  autoLiabilityExpirationDate: text("auto_liability_expiration_date"),
  autoLiabilityDocumentUrl: text("auto_liability_document_url"),
  // W-9 (or W-8 BEN equivalent) supporting document. Stored as an
  // object-storage URL (signed-on-read). Required before a partner can
  // approve the vendor — partner AP teams universally need this on
  // file before the first invoice clears.
  w9DocumentUrl: text("w9_document_url"),
  w9LastUpdatedAt: timestamp("w9_last_updated_at", { withTimezone: true }),
  // Vendor's most-recently-published catalog version. Updated by the
  // /vendors/:id/catalog/publish endpoint inside the same transaction
  // that inserts the vendor_catalog_versions row. Nullable for vendors
  // who have not yet published their first catalog (legacy rows
  // backfilled by a one-shot script after this migration lands).
  currentCatalogVersionId: integer("current_catalog_version_id"),
  // Vendor-side authority attestation: the timestamp the vendor admin
  // confirmed (in the catalog publish flow) that they have authority
  // to bind their org to the rates and terms in the published catalog.
  // Required to be non-null before a publish proceeds; cleared when
  // the underlying rates/work-types are edited (forcing a fresh
  // attestation on the next publish).
  catalogAuthorityAttestedAt: timestamp(
    "catalog_authority_attested_at",
    { withTimezone: true },
  ),
  catalogAuthorityAttestedByUserId: integer(
    "catalog_authority_attested_by_user_id",
  ),
  // Days-past-due thresholds the aging worker fires reminders at. JSONB
  // array of integers. Default mirrors the historical hardcoded value so
  // existing vendors keep current behavior with no migration drift.
  agingThresholdDays: jsonb("aging_threshold_days")
    .$type<number[]>()
    .notNull()
    .default(sql`'[1,15,30]'::jsonb`),
  // 1099 e-delivery consent. IRS Pub 1179 / Reg §31.6051-1(j) require an
  // affirmative, recorded consent before a payee may receive their copy of
  // a 1099 electronically (otherwise it must be mailed). Stored as a flag
  // plus the timestamp the recipient gave consent and an optional override
  // email (defaults to vendors.contactEmail when null). Revoking consent
  // sets the flag false but preserves the original consent timestamp for
  // audit trail. e_delivery_consent_at is null when no consent has ever
  // been given.
  eDeliveryConsent: boolean("e_delivery_consent").notNull().default(false),
  eDeliveryConsentAt: timestamp("e_delivery_consent_at", {
    withTimezone: true,
  }),
  eDeliveryEmail: text("e_delivery_email"),
  // When true, an email digest is sent to vendor admins after a QBO/OA push
  // that produced any per-row warnings. Default true so existing vendors
  // start receiving digests immediately. Toggle from the Reports page.
  accountingFailureNotificationsEnabled: boolean(
    "accounting_failure_notifications_enabled",
  )
    .notNull()
    .default(true),
  // When true, an email digest is sent to vendor admins after a QBO/OA push
  // that posted every row successfully but where the post-push reconciler
  // found drift between VNDRLY's totals/per-state tax and what the
  // accounting system actually stored. Distinct from
  // `accountingFailureNotificationsEnabled` so admins can opt in
  // incrementally — silent reconciliation drift is a softer signal than
  // outright row failures and not every team wants those alerts.
  // Default false: opt-in to avoid surprising existing vendors with new
  // emails on the first push after this column lands.
  accountingReconciliationNotificationsEnabled: boolean(
    "accounting_reconciliation_notifications_enabled",
  )
    .notNull()
    .default(false),
  // Cadence for the reconciliation-drift digest above. Two values:
  //   * "per_push"     — send one email immediately after every push that
  //                      surfaces reconciliation drift (legacy behavior).
  //   * "weekly_recap" — suppress the per-push email; a background worker
  //                      aggregates the past 7 days of reconciliation
  //                      warnings into a single summary email per week.
  // Stored as text (not pgEnum) so adding a new cadence later is a
  // schema-only change. Default "per_push" preserves existing behavior
  // for vendors who already opted in to reconciliation alerts.
  accountingReconciliationDigestCadence: text(
    "accounting_reconciliation_digest_cadence",
  )
    .notNull()
    .default("per_push"),
  platformEulaAcceptedAt: timestamp("platform_eula_accepted_at", { withTimezone: true }),
  platformEulaVersion: text("platform_eula_version"),
  platformEulaHash: text("platform_eula_hash"),
  platformEulaAcceptedByUserId: integer("platform_eula_accepted_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Case-insensitive uniqueness on the trimmed display name. Prevents
  // re-seeds (or hand-typed duplicates) from re-creating the legacy
  // "Select Water Solutions" ×2 / "Baker Hughes" + "Baker Hughes Field
  // Svcs"-style splits the dedupe-vendors script had to clean up. Stored
  // as an expression index (not a generated column) so existing
  // application code that reads/writes `name` keeps the user's exact
  // casing and whitespace.
  uniqCanonicalName: uniqueIndex("vendors_canonical_name_unique").on(
    sql`lower(btrim(${t.name}))`,
  ),
  platformEulaAcceptedByUserFk: foreignKey({
    name: "vendors_platform_eula_accepted_by_user_id_fkey",
    columns: [t.platformEulaAcceptedByUserId],
    foreignColumns: [usersTable.id],
  }).onDelete("set null"),
}));

export const insertVendorSchema = createInsertSchema(vendorsTable).omit({ id: true, createdAt: true });
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendorsTable.$inferSelect;
