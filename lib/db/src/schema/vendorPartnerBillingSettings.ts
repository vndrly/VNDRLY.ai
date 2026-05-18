import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { partnersTable } from "./partners";
import type { LateFeeRule } from "./invoices";
import type {
  InvoiceLineType,
  InvoiceLineIncomeCategory,
} from "./invoiceLines";

// Per-(vendor, partner) override mapping from invoice line_type → 1099 income
// category. The invoice generator first consults this map to pick the default
// income_category for a freshly emitted line; falls back to the engine's
// built-in defaults when a key isn't present. Lets a customer with unusual
// billing (e.g. a vendor whose "equipment" charges are reimbursable medical
// equipment, or whose "other" lines are royalties) tune the auto-suggest
// without hand-editing every line. Manual per-line overrides made via the
// invoice-detail UI still win — those carry is_manual_override=true and are
// never replaced on regeneration.
export type IncomeCategoryOverrideMap = Partial<
  Record<InvoiceLineType, InvoiceLineIncomeCategory>
>;

export const vendorPartnerBillingSettingsTable = pgTable(
  "vendor_partner_billing_settings",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    cadence: text("cadence").notNull().default("per_ticket"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    remitToAddress: text("remit_to_address"),
    remitToName: text("remit_to_name"),
    mileageAutoSuggest: boolean("mileage_auto_suggest").notNull().default(false),
    mileageRate: numeric("mileage_rate", { precision: 10, scale: 4 }),
    overtimeMultiplier: numeric("overtime_multiplier", { precision: 4, scale: 2 })
      .notNull()
      .default("1.50"),
    lateFeeRule: jsonb("late_fee_rule").$type<LateFeeRule | null>(),
    // Per-line-type overrides for the 1099 income_category auto-suggest. See
    // IncomeCategoryOverrideMap above. Stored as a JSON object whose keys are
    // any subset of INVOICE_LINE_TYPES and whose values are any of
    // INVOICE_LINE_INCOME_CATEGORIES. Null/missing key means "use engine
    // default". Validated at the route layer; the engine treats unknown keys
    // as no-override.
    defaultIncomeCategoryOverrides: jsonb(
      "default_income_category_overrides",
    ).$type<IncomeCategoryOverrideMap | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqVendorPartner: uniqueIndex("vp_billing_settings_unique").on(
      t.vendorId,
      t.partnerId,
    ),
  }),
);

export const INVOICE_CADENCES = ["per_ticket", "weekly", "monthly"] as const;
export type InvoiceCadence = (typeof INVOICE_CADENCES)[number];

export const insertVendorPartnerBillingSettingsSchema = createInsertSchema(
  vendorPartnerBillingSettingsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorPartnerBillingSettings = z.infer<
  typeof insertVendorPartnerBillingSettingsSchema
>;
export type VendorPartnerBillingSettings =
  typeof vendorPartnerBillingSettingsTable.$inferSelect;
