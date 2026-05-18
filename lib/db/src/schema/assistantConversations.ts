import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const assistantConversationsTable = pgTable(
  "assistant_conversations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New conversation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    byUser: index("assistant_conversations_user_idx").on(t.userId, t.updatedAt),
  }),
);

export type AssistantConversation = typeof assistantConversationsTable.$inferSelect;
export type AssistantConversationInsert = typeof assistantConversationsTable.$inferInsert;
