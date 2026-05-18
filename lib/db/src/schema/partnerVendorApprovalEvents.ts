import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { usersTable } from "./users";
import { vendorCatalogVersionsTable } from "./vendorCatalogVersions";

// Why each (partner, vendor) approval status transition happened.
// One row per state change; the latest row's `toStatus` will match
// `partner_vendor_relationships.status`. Used both for the audit
// trail (legal defense of "you saw this lapse and didn't act") and to
// drive the partner-facing "Re-approval needed because..." banner.
export const PARTNER_VENDOR_APPROVAL_EVENT_REASONS = [
  "manual_approve",
  "manual_revoke",
  "manual_unapprove",
  "manual_pending_review",
  "partner_eula_accepted",
  "vendor_catalog_published",
  "vendor_pricing_changed",
  "vendor_compliance_updated",
  "coi_expired",
  "wc_expired",
  "gl_expired",
  "auto_liability_expired",
  "qualified_employee_lapse",
  "system_recompute",
] as const;
export type PartnerVendorApprovalEventReason =
  (typeof PARTNER_VENDOR_APPROVAL_EVENT_REASONS)[number];

export const partnerVendorApprovalEventsTable = pgTable(
  "partner_vendor_approval_events",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason").notNull(),
    // Free-form details (which cert expired, which work type changed,
    // delta jsonb, etc) for the audit trail. Kept loose because every
    // reason carries different shape.
    reasonDetail: jsonb("reason_detail").$type<Record<string, unknown>>(),
    // The catalog version in play at the time of the event (the
    // version the partner was on, or the version the vendor just
    // published). Nullable because expiry/cert events aren't tied to
    // a publish.
    vendorCatalogVersionId: integer("vendor_catalog_version_id").references(
      () => vendorCatalogVersionsTable.id,
      { onDelete: "set null" },
    ),
    // Who (if anyone) triggered this manually. Null = automated worker
    // / system.
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairIdx: index("partner_vendor_approval_events_pair_idx").on(
      t.partnerId,
      t.vendorId,
      t.createdAt,
    ),
    vendorIdx: index("partner_vendor_approval_events_vendor_idx").on(
      t.vendorId,
    ),
  }),
);

export const insertPartnerVendorApprovalEventSchema = createInsertSchema(
  partnerVendorApprovalEventsTable,
).omit({ id: true, createdAt: true });
export type InsertPartnerVendorApprovalEvent = z.infer<
  typeof insertPartnerVendorApprovalEventSchema
>;
export type PartnerVendorApprovalEvent =
  typeof partnerVendorApprovalEventsTable.$inferSelect;
