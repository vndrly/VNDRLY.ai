import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton row keyed at id=1. Holds VNDRLY's own "company info" so the
// admin portal can self-edit the same fields a Partner or Vendor edits on
// their own org page (name, contacts, addresses, brand colors, logos).
// We model this as a one-row table rather than an env-driven config so:
//   1) admins can edit it from the UI without a redeploy,
//   2) it composes naturally with the same React Query / OpenAPI flow,
//   3) future per-tenant white-label work would just promote `id` from a
//      hardcoded 1 to a real key.
export const platformSettingsTable = pgTable("platform_settings", {
  id: integer("id").primaryKey().notNull(),
  name: text("name").notNull().default("VNDRLY"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  physicalAddress: text("physical_address"),
  billingAddress: text("billing_address"),
  businessPhone: text("business_phone"),
  hoursOfOperation: text("hours_of_operation"),
  blurb: text("blurb"),
  logoUrl: text("logo_url"),
  logoSquareUrl: text("logo_square_url"),
  brandPrimaryColor: text("brand_primary_color"),
  brandAccentColor: text("brand_accent_color"),
  // Admin-tunable override for the QuickBooks-mapping bulk-action undo
  // retention window (in days). NULL means "fall back to the
  // QB_BULK_ACTION_RETENTION_DAYS env var, which itself falls back to
  // the 90-day code default". The cleanup worker and the
  // `/reports/qb-account-mapping/bulk-actions` list endpoint both read
  // through `getBulkActionRetentionDays()` so a UI change here picks up
  // automatically on the next sweep + the next page load.
  qbBulkActionRetentionDays: integer("qb_bulk_action_retention_days"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlatformSettingsSchema = createInsertSchema(platformSettingsTable).omit({ updatedAt: true });
export type InsertPlatformSettings = z.infer<typeof insertPlatformSettingsSchema>;
export type PlatformSettings = typeof platformSettingsTable.$inferSelect;
