import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { hotlistJobsTable } from "./hotlistJobs";
import { usersTable } from "./users";

export const hotlistCommentsTable = pgTable("hotlist_comments", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => hotlistJobsTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  attachments: text("attachments").array(),
  mentions: integer("mentions").array(),
  editHistory: jsonb("edit_history"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedById: integer("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HotlistComment = typeof hotlistCommentsTable.$inferSelect;
