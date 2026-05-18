import {
  pgTable,
  serial,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { usersTable } from "./users";

// A snapshot of a vendor's "approved catalog" — the bundle of pricing,
// work types, compliance state, and the EULA text the vendor was
// publishing on at the moment of publication. Partners approve a
// SPECIFIC version. Any subsequent edit to the live vendor record
// (rates, work-type prices, COI/WC/GL renewal, attestation) by the
// vendor produces a new version, which auto-unapproves every partner
// rel still pointing at the old version.
export const vendorCatalogVersionsTable = pgTable(
  "vendor_catalog_versions",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    // Per-vendor monotonic version number (1, 2, 3, ...). Surfaced in
    // the UI as "v3" so partners can see at a glance whether they are
    // approving a fresh cut or re-approving an old one.
    version: integer("version").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedByUserId: integer("published_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    // Free-form note from the vendor explaining what changed in this
    // cut (e.g. "Bumped switching rates 6%"). Surfaced verbatim in the
    // partner re-approval diff modal.
    changeSummary: text("change_summary"),
    // Frozen snapshots of the vendor's pricing/work-types/compliance
    // at publish time. Stored as jsonb so the "diff between approved
    // and current version" view is a pure data compare without joins.
    ratesSnapshot: jsonb("rates_snapshot")
      .$type<{
        dailyOtHours: string | null;
        weeklyOtHours: string | null;
        overtimeMultiplier: string | null;
      }>()
      .notNull(),
    workTypesSnapshot: jsonb("work_types_snapshot")
      .$type<
        Array<{
          workTypeId: number;
          workTypeName: string;
          unitPrice: string | null;
          unit: string | null;
          currency: string;
        }>
      >()
      .notNull(),
    complianceSnapshot: jsonb("compliance_snapshot")
      .$type<{
        coi: { carrier: string | null; policyNumber: string | null; expirationDate: string | null; documentUrl: string | null } | null;
        wc: { carrier: string | null; policyNumber: string | null; expirationDate: string | null; documentUrl: string | null } | null;
        gl: { carrier: string | null; policyNumber: string | null; expirationDate: string | null; documentUrl: string | null } | null;
        autoLiability: { carrier: string | null; policyNumber: string | null; expirationDate: string | null; documentUrl: string | null } | null;
        w9DocumentUrl: string | null;
      }>()
      .notNull(),
    // Verbatim EULA text the partner is required to accept to promote
    // the relationship to "approved" on this catalog version. Frozen
    // here so amending the vendor's master EULA template doesn't
    // retroactively change what previously-accepting partners agreed
    // to.
    eulaText: text("eula_text").notNull(),
    // Optional hash of `eulaText` for quick equality checks across
    // versions (so the UI can show "EULA unchanged" when a version
    // bump only touches pricing).
    eulaHash: text("eula_hash"),
  },
  (t) => ({
    uniqVendorVersion: uniqueIndex("vendor_catalog_versions_vendor_version_unique").on(
      t.vendorId,
      t.version,
    ),
    vendorIdx: index("vendor_catalog_versions_vendor_idx").on(t.vendorId),
  }),
);

export const insertVendorCatalogVersionSchema = createInsertSchema(
  vendorCatalogVersionsTable,
).omit({ id: true, publishedAt: true });
export type InsertVendorCatalogVersion = z.infer<
  typeof insertVendorCatalogVersionSchema
>;
export type VendorCatalogVersion =
  typeof vendorCatalogVersionsTable.$inferSelect;
