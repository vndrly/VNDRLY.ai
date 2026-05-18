import { pgTable, text, serial, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workTypesTable = pgTable(
  "work_types",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    estimatedDuration: text("estimated_duration"),
    estimatedPrice: numeric("estimated_price", { precision: 12, scale: 2 }),
    requiredCertifications: text("required_certifications").array(),
    // Task #651: per-cert "blocking" flag distinguishing warn-only
    // (`required_certifications`) from hard-blocking certifications.
    // A cert listed here causes POST /tickets/:id/schedule to reject
    // with `code: "schedule.certifications_blocked"` (HTTP 400) when a
    // crew member is missing or has an expired copy. Compliance teams
    // use it for hot-work / confined-space / H2S-exposed work types
    // where a missing cert must not be silently overridable. Platform
    // admins can still POST with `overrideBlockingCerts: true` to push
    // through; that override is captured in
    // `schedule_cert_override_audit_log` so the bypass is traceable.
    // Stored as a separate column rather than a single enum on
    // `required_certifications` so a single work type can mix warn-only
    // and blocking entries without a schema migration per cert.
    blockingCertifications: text("blocking_certifications").array(),
  },
  (t) => ({
    // Case-insensitive uniqueness on the trimmed display name. Mirrors
    // partners_canonical_name_unique and vendors_canonical_name_unique —
    // same problem shape: a re-seed or hand-edit could otherwise
    // re-introduce duplicate "Frac Crew" / "frac crew" rows that would
    // silently splinter partner_work_type_afes, vendor_work_types,
    // work_type_site_locations, and ticket rate-card lookups across two
    // work-type rows. Stored as an expression index (not a generated
    // column) so existing application code that reads/writes `name`
    // keeps the user's exact casing and whitespace.
    uniqCanonicalName: uniqueIndex("work_types_canonical_name_unique").on(
      sql`lower(btrim(${t.name}))`,
    ),
  }),
);

export const insertWorkTypeSchema = createInsertSchema(workTypesTable).omit({ id: true });
export type InsertWorkType = z.infer<typeof insertWorkTypeSchema>;
export type WorkType = typeof workTypesTable.$inferSelect;
