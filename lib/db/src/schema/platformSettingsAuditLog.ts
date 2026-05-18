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
import { usersTable } from "./users";

// Append-only audit trail of changes to specific fields on the
// singleton `platform_settings` row. Today only the QuickBooks
// bulk-action undo-retention field is audited (an operations setting
// sensitive enough to warrant a "who/when" trail), but the table is
// keyed by `field` so future audited columns can re-use it without a
// new migration.
//
// One row is appended per save, with the previous and new values
// stored as text for forward-compatibility with non-numeric fields.
// `null` prevValue/newValue means "no override / system default".
export const platformSettingsAuditLogTable = pgTable(
  "platform_settings_audit_log",
  {
    id: serial("id").primaryKey(),
    /** Camel-case column name on `platform_settings` that changed —
     *  e.g. "qbBulkActionRetentionDays". */
    field: text("field").notNull(),
    /** Stringified previous value, or null when the field was unset
     *  (using the system default). */
    prevValue: text("prev_value"),
    /** Stringified new value, or null when the change cleared the
     *  override back to the system default. */
    newValue: text("new_value"),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxFieldCreatedAt: index("platform_settings_audit_field_created_idx").on(
      t.field,
      t.createdAt,
    ),
  }),
);

export const insertPlatformSettingsAuditLogSchema = createInsertSchema(
  platformSettingsAuditLogTable,
).omit({ id: true, createdAt: true });
export type InsertPlatformSettingsAuditLog = z.infer<
  typeof insertPlatformSettingsAuditLogSchema
>;
export type PlatformSettingsAuditLog =
  typeof platformSettingsAuditLogTable.$inferSelect;
