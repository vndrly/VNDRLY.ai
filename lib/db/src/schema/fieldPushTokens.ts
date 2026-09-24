import { pgTable, text, serial, timestamp, integer, index, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const fieldPushTokensTable = pgTable(
  "field_push_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expoToken: text("expo_token").notNull().unique(),
    platform: text("platform"),
    // DeviceNotRegistered is a registration-owned barrier, independent of dismissible inbox rows.
    retirementPending: boolean("retirement_pending").notNull().default(false),
    retirementRequestedAt: timestamp("retirement_requested_at", { withTimezone: true }),
    retirementLeaseToken: text("retirement_lease_token"),
    retirementLeaseUntil: timestamp("retirement_lease_until", { withTimezone: true }),
    retirementAttemptCount: integer("retirement_attempt_count").notNull().default(0),
    retirementLastAttemptAt: timestamp("retirement_last_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("field_push_tokens_user_idx").on(t.userId),
    retirementIdx: index("field_push_tokens_retirement_idx").on(t.retirementPending, t.retirementLeaseUntil),
  }),
);

export type FieldPushToken = typeof fieldPushTokensTable.$inferSelect;
