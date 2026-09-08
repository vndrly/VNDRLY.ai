import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubChannelsTable } from "./workHubChannels";

export const workHubNotesTable = pgTable("work_hub_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => workHubChannelsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  updatedById: integer("updated_by_id").notNull().references(() => usersTable.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ channelIdx: index("work_hub_notes_channel_idx").on(t.channelId, t.updatedAt) }));

export const workHubNoteVersionsTable = pgTable("work_hub_note_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  noteId: uuid("note_id").notNull().references(() => workHubNotesTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  editorUserId: integer("editor_user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqueVersion: uniqueIndex("work_hub_note_versions_unique").on(t.noteId, t.version) }));
