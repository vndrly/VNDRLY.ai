import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { usersTable } from "./users";
import { vendorCatalogVersionsTable } from "./vendorCatalogVersions";

// Records each time a partner-side authorized user accepts the EULA
// bound to a specific vendor catalog version. We do NOT enforce a
// uniqueness constraint on (partner, vendor, version) — multiple
// users on the partner side may each acknowledge, and the latest row
// is the one consulted by the approval gate. Insert-only audit table.
export const partnerEulaAcceptancesTable = pgTable(
  "partner_eula_acceptances",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    vendorCatalogVersionId: integer("vendor_catalog_version_id")
      .notNull()
      .references(() => vendorCatalogVersionsTable.id, {
        onDelete: "cascade",
      }),
    acceptedByUserId: integer("accepted_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "set null" }),
    // Hashed text the user actually clicked through (frozen snapshot
    // from vendor_catalog_versions.eula_text at acceptance time). Kept
    // even though the version row already has it: defends against a
    // hypothetical retro-edit of the catalog version row by an
    // operator with DB access.
    acceptedEulaHash: text("accepted_eula_hash").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairIdx: index("partner_eula_acceptances_pair_idx").on(
      t.partnerId,
      t.vendorId,
      t.vendorCatalogVersionId,
    ),
  }),
);

export const insertPartnerEulaAcceptanceSchema = createInsertSchema(
  partnerEulaAcceptancesTable,
).omit({ id: true, acceptedAt: true });
export type InsertPartnerEulaAcceptance = z.infer<
  typeof insertPartnerEulaAcceptanceSchema
>;
export type PartnerEulaAcceptance =
  typeof partnerEulaAcceptancesTable.$inferSelect;
