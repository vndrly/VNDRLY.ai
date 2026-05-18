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

// Append-only audit trail of every change to the singleton
// fire_transmitter_settings row. We capture the full
// { columnName: { before, after } } diff (jsonb) plus the actor's user
// id, role, IP, and User-Agent so a future "transmitter info history"
// view can show "admin X changed our IRS TCC from … to … on …" without
// re-deriving state.
//
// One row is appended per save (not per field), so concurrent saves
// stay well-ordered by `created_at`.
export const fireTransmitterSettingsAuditLogTable = pgTable(
  "fire_transmitter_settings_audit_log",
  {
    id: serial("id").primaryKey(),
    /** { columnName: { before: <prev>, after: <new> } } for every
     *  column that changed in this save. */
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
    idxCreatedAt: index("fire_transmitter_settings_audit_created_idx").on(
      t.createdAt,
    ),
  }),
);

export const insertFireTransmitterSettingsAuditLogSchema = createInsertSchema(
  fireTransmitterSettingsAuditLogTable,
).omit({ id: true, createdAt: true });
export type InsertFireTransmitterSettingsAuditLog = z.infer<
  typeof insertFireTransmitterSettingsAuditLogSchema
>;
export type FireTransmitterSettingsAuditLog =
  typeof fireTransmitterSettingsAuditLogTable.$inferSelect;
