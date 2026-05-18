import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("field_push_tokens_user_idx").on(t.userId),
  }),
);

export type FieldPushToken = typeof fieldPushTokensTable.$inferSelect;
