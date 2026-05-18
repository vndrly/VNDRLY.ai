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
import { usersTable } from "./users";
import { siteLocationsTable } from "./siteLocations";

// Audit trail of admin overrides on a site_locations row. The first
// caller is the "un-hide / restore superseded site" toggle on the admin
// site-location detail page: the well-ingestion pipeline marks broad
// county-area anchors as hidden=true once real wells are inserted for
// the operator, and an admin can manually reverse that decision when
// the real wells aren't loaded yet. We capture before/after JSON of the
// changed columns so a future "site location admin history" UI can
// show "admin X un-hid this site at Y" without re-deriving state.
//
// `siteLocationId` keeps an FK so cascading the site away (rare, since
// our delete is soft) sets it null instead of orphaning the audit row.
export const siteLocationAdminAuditLogTable = pgTable(
  "site_location_admin_audit_log",
  {
    id: serial("id").primaryKey(),
    siteLocationId: integer("site_location_id").references(
      () => siteLocationsTable.id,
      { onDelete: "set null" },
    ),
    /** Short machine-readable action label. Today: "unhide" | "hide".
     *  Future admin overrides on this table should add their own label
     *  rather than overloading these. */
    action: text("action").notNull(),
    /** { columnName: { before: <prev>, after: <new> } } for every
     *  column the override touched. Stored as jsonb so the schema can
     *  grow without a migration here. */
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    actorIp: text("actor_ip"),
    actorUserAgent: text("actor_user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxSite: index("site_location_admin_audit_site_idx").on(
      t.siteLocationId,
      t.createdAt,
    ),
    idxCreatedAt: index("site_location_admin_audit_created_idx").on(
      t.createdAt,
    ),
  }),
);

export const insertSiteLocationAdminAuditLogSchema = createInsertSchema(
  siteLocationAdminAuditLogTable,
).omit({ id: true, createdAt: true });
export type InsertSiteLocationAdminAuditLog = z.infer<
  typeof insertSiteLocationAdminAuditLogSchema
>;
export type SiteLocationAdminAuditLog =
  typeof siteLocationAdminAuditLogTable.$inferSelect;
