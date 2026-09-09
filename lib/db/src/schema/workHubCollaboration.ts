import { integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubChannelsTable } from "./workHubChannels";

export const workHubCrewsTable = pgTable("work_hub_crews", {
  id: uuid("id").primaryKey().defaultRandom(), name: text("name").notNull(),
  ownerOrgType: text("owner_org_type").notNull(), ownerOrgId: integer("owner_org_id").notNull(),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const workHubCrewMembersTable = pgTable("work_hub_crew_members", {
  id: uuid("id").primaryKey().defaultRandom(), crewId: uuid("crew_id").notNull().references(() => workHubCrewsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id), mode: text("mode").notNull().default("member"),
}, t => ({ member: uniqueIndex("work_hub_crew_members_unique").on(t.crewId, t.userId) }));
export const workHubCollaborationChannelsTable = pgTable("work_hub_collaboration_channels", {
  channelId: uuid("channel_id").primaryKey().references(() => workHubChannelsTable.id),
  crewId: uuid("crew_id").references(() => workHubCrewsTable.id), kind: text("kind").notNull(),
});
export const workHubChatInvitationsTable = pgTable("work_hub_chat_invitations", {
  id: uuid("id").primaryKey().defaultRandom(), channelId: uuid("channel_id").notNull().references(() => workHubChannelsTable.id),
  senderUserId: integer("sender_user_id").notNull().references(() => usersTable.id),
  recipientUserId: integer("recipient_user_id").notNull().references(() => usersTable.id),
  status: text("status").notNull().default("pending"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ recipient: uniqueIndex("work_hub_chat_invitation_recipient_unique").on(t.channelId, t.recipientUserId) }));
export const workHubPreferencesTable = pgTable("work_hub_preferences", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
});
