import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const locationConsentsTable = pgTable(
  "location_consents",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    uniq: uniqueIndex("location_consents_user_device_uniq").on(t.userId, t.deviceId),
  }),
);

export type LocationConsent = typeof locationConsentsTable.$inferSelect;
