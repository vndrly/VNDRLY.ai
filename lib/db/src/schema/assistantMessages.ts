import { pgTable, serial, text, timestamp, integer, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { assistantConversationsTable } from "./assistantConversations";

export const assistantMessagesTable = pgTable(
  "assistant_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => assistantConversationsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    toolCalls: jsonb("tool_calls").default(sql`'[]'::jsonb`),
    // Telemetry: time from request received to first text token streamed
    // back to the client, in milliseconds. Only set on assistant rows;
    // null on user rows and on rows that errored before any token.
    firstTokenMs: integer("first_token_ms"),
    // Telemetry: heuristic flag set when the assistant turn was a
    // canned refusal (cross-tenant lookup, role-gated tool, etc.). Used
    // by the admin metrics card to surface friction.
    refusal: boolean("refusal").notNull().default(false),
    // Explicit user thumbs-up/down on an assistant turn (session chat only).
    feedbackRating: text("feedback_rating"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byConv: index("assistant_messages_conv_idx").on(t.conversationId, t.createdAt),
  }),
);

export type AssistantMessage = typeof assistantMessagesTable.$inferSelect;
export type AssistantMessageInsert = typeof assistantMessagesTable.$inferInsert;
