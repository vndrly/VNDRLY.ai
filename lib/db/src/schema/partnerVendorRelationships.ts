import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { usersTable } from "./users";

export const partnerVendorRelationshipsTable = pgTable(
  "partner_vendor_relationships",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    // One of PARTNER_VENDOR_RELATIONSHIP_STATUSES below. Stored as a
    // text column so a constants-only change can ship without a real
    // enum migration; integrity is policed at the route + derivation
    // layer.
    status: text("status").notNull(),
    notes: text("notes"),
    ratedAt: timestamp("rated_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByUserId: integer("approved_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    // Catalog version the partner currently approves. Set on
    // promotion to "approved", cleared on revoke. The
    // approval-derivation engine compares this against
    // vendors.current_catalog_version_id and flips the relationship to
    // `auto_unapproved` when they diverge.
    approvedCatalogVersionId: integer("approved_catalog_version_id"),
    // Machine-readable last status reason (matches the
    // partner_vendor_approval_events.reason vocabulary). Denormalized
    // here so the approvals-card list query is a single round-trip
    // without joining the full event log.
    lastStatusReason: text("last_status_reason"),
    lastStatusChangeAt: timestamp("last_status_change_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    partnerVendorUnique: uniqueIndex("partner_vendor_relationship_unique").on(
      t.partnerId,
      t.vendorId,
    ),
  }),
);

export const insertPartnerVendorRelationshipSchema = createInsertSchema(
  partnerVendorRelationshipsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPartnerVendorRelationship = z.infer<
  typeof insertPartnerVendorRelationshipSchema
>;
export type PartnerVendorRelationship =
  typeof partnerVendorRelationshipsTable.$inferSelect;

// Lifecycle-aware vendor approval statuses. The legacy "preferred"
// value is migrated to "pending_review" by the schema-push companion
// script — partner admins still see those rows in their queue, just
// re-labeled, until they explicitly approve or revoke.
//
// - unapproved        : partner has never engaged with this vendor's
//                       catalog beyond seeing them in search.
// - pending_review    : partner has work to do (a fresh catalog has
//                       been published, an attestation is needed, or
//                       a legacy "preferred" rel was migrated).
// - approved          : partner has acknowledged the current catalog
//                       version, EULA, and compliance state.
// - auto_unapproved   : derivation engine flipped the rel — vendor
//                       changed pricing/compliance or a doc expired
//                       since the partner's last approval.
// - revoked           : partner explicitly removed approval (won't be
//                       auto-promoted; requires manual re-engagement).
export const PARTNER_VENDOR_RELATIONSHIP_STATUSES = [
  "unapproved",
  "pending_review",
  "approved",
  "auto_unapproved",
  "revoked",
] as const;
export type PartnerVendorRelationshipStatus =
  (typeof PARTNER_VENDOR_RELATIONSHIP_STATUSES)[number];

// Statuses that count as "active approval" in downstream filters
// (work-type assignment dropdowns, ticket creation, hotlist bid
// eligibility). Centralized so policy changes are one-line edits.
export const ACTIVE_APPROVAL_STATUSES: PartnerVendorRelationshipStatus[] = [
  "approved",
];
