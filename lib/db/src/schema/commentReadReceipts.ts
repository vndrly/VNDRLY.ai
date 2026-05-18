import { pgTable, serial, timestamp, integer, text, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Polymorphic read receipt: source = "ticket" | "hotlist", commentId points
// to ticket_note_logs.id or hotlist_comments.id respectively.
export const commentReadReceiptsTable = pgTable(
  "comment_read_receipts",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    commentId: integer("comment_id").notNull(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("comment_read_receipts_uniq").on(t.source, t.commentId, t.userId),
  }),
);

export type CommentReadReceipt = typeof commentReadReceiptsTable.$inferSelect;
