import { type AnyPgColumn, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubChannelsTable } from "./workHubChannels";

export const workHubMessagesTable = pgTable("work_hub_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => workHubChannelsTable.id, { onDelete: "cascade" }),
  rootMessageId: uuid("root_message_id").references((): AnyPgColumn => workHubMessagesTable.id),
  parentMessageId: uuid("parent_message_id").references((): AnyPgColumn => workHubMessagesTable.id),
  authorUserId: integer("author_user_id").notNull().references(() => usersTable.id),
  kind: text("kind").notNull().default("text"),
  body: text("body").notNull().default(""),
  version: integer("version").notNull().default(1),
  clientOperationId: uuid("client_operation_id").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedById: integer("deleted_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  channelCursorIdx: index("work_hub_messages_channel_cursor_idx").on(t.channelId, t.createdAt, t.id),
  operationUnique: uniqueIndex("work_hub_messages_author_operation_unique").on(t.authorUserId, t.clientOperationId),
}));

export const workHubMessageVersionsTable = pgTable("work_hub_message_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => workHubMessagesTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  body: text("body").notNull(),
  editorUserId: integer("editor_user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqueVersion: uniqueIndex("work_hub_message_versions_unique").on(t.messageId, t.version) }));

export const workHubMentionsTable = pgTable("work_hub_mentions", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => workHubMessagesTable.id, { onDelete: "cascade" }),
  mentionedUserId: integer("mentioned_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqueMention: uniqueIndex("work_hub_mentions_unique").on(t.messageId, t.mentionedUserId) }));

export const workHubReactionsTable = pgTable("work_hub_reactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => workHubMessagesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqueReaction: uniqueIndex("work_hub_reactions_unique").on(t.messageId, t.userId, t.emoji) }));

export const workHubReadCursorsTable = pgTable("work_hub_read_cursors", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => workHubChannelsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lastMessageId: uuid("last_message_id").references(() => workHubMessagesTable.id),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqueCursor: uniqueIndex("work_hub_read_cursors_unique").on(t.channelId, t.userId) }));

export const workHubMessageMetadataTable = pgTable("work_hub_message_metadata", {
  messageId: uuid("message_id").primaryKey().references(() => workHubMessagesTable.id, { onDelete: "cascade" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
});
