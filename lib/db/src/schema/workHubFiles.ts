import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubChannelsTable } from "./workHubChannels";

export const workHubFilesTable = pgTable("work_hub_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  channelId: uuid("channel_id").references(() => workHubChannelsTable.id, { onDelete: "cascade" }),
  uploadedById: integer("uploaded_by_id").notNull().references(() => usersTable.id),
  storageKey: text("storage_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  state: text("state").notNull().default("reserved"),
  retentionClass: text("retention_class").notNull().default("standard"),
  mediaMetadata: jsonb("media_metadata").$type<Record<string, unknown>>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerIdx: index("work_hub_files_owner_idx").on(t.ownerOrgType, t.ownerOrgId, t.createdAt) }));
