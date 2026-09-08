import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const workHubChannelsTable = pgTable("work_hub_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  contextKind: text("context_kind").notNull(),
  contextId: text("context_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contextUnique: uniqueIndex("work_hub_channels_context_unique").on(t.ownerOrgType, t.ownerOrgId, t.contextKind, t.contextId),
  ownerIdx: index("work_hub_channels_owner_idx").on(t.ownerOrgType, t.ownerOrgId, t.updatedAt),
}));

export const workHubChannelMembersTable = pgTable("work_hub_channel_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => workHubChannelsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqueMember: uniqueIndex("work_hub_channel_members_unique").on(t.channelId, t.userId) }));
