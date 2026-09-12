import { bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubMeetingOccurrencesTable } from "./workHubMeetings";

export type WorkHubDeviceCapabilities = {
  microphone?: boolean; speaker?: boolean; camera?: boolean;
  fileSelection?: boolean; pushNotifications?: boolean;
};

const organization = {
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
};

export const workHubDevicesTable = pgTable("work_hub_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ...organization,
  friendlyName: text("friendly_name").notNull(),
  deviceClass: text("device_class").notNull(),
  capabilities: jsonb("capabilities").$type<WorkHubDeviceCapabilities>().notNull().default({}),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ userOrgIdx: index("work_hub_devices_user_org_idx").on(t.userId, t.ownerOrgType, t.ownerOrgId) }));

export const workHubDeviceConnectionsTable = pgTable("work_hub_device_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id").notNull().references(() => workHubDevicesTable.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull(),
  foreground: boolean("foreground").notNull().default(false),
  microphonePermission: text("microphone_permission").notNull().default("unknown"),
  surface: jsonb("surface").$type<Record<string, unknown>>().notNull().default({}),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ deviceUnique: uniqueIndex("work_hub_device_connections_device_unique").on(t.deviceId, t.connectionId), seenIdx: index("work_hub_device_connections_seen_idx").on(t.seenAt) }));

export const workHubWorkspaceSessionsTable = pgTable("work_hub_workspace_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ...organization,
  occurrenceId: uuid("occurrence_id").references(() => workHubMeetingOccurrencesTable.id),
  assistantConversationId: integer("assistant_conversation_id"),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ userOrgUnique: uniqueIndex("work_hub_workspace_sessions_user_org_unique").on(t.userId, t.ownerOrgType, t.ownerOrgId) }));

export const workHubAudioLeasesTable = pgTable("work_hub_audio_leases", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurrenceId: uuid("occurrence_id").notNull().references(() => workHubMeetingOccurrencesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull().references(() => workHubDevicesTable.id),
  generation: integer("generation").notNull().default(1),
  tokenHash: text("token_hash").notNull(),
  state: text("state").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ occurrenceUserUnique: uniqueIndex("work_hub_audio_leases_occurrence_user_unique").on(t.occurrenceId, t.userId) }));

export const workHubDevicePreferencesTable = pgTable("work_hub_device_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ...organization,
  rankedDeviceIds: jsonb("ranked_device_ids").$type<string[]>().notNull().default([]),
  automaticBackupDeviceIds: jsonb("automatic_backup_device_ids").$type<string[]>().notNull().default([]),
  learning: jsonb("learning").$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ userOrgUnique: uniqueIndex("work_hub_device_preferences_user_org_unique").on(t.userId, t.ownerOrgType, t.ownerOrgId) }));

export const workHubUserEventsTable = pgTable("work_hub_user_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequence: bigserial("sequence", { mode: "number" }).notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ...organization,
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ sequenceUnique: uniqueIndex("work_hub_user_events_sequence_unique").on(t.sequence), userOrgSequenceIdx: index("work_hub_user_events_user_org_sequence_idx").on(t.userId, t.ownerOrgType, t.ownerOrgId, t.sequence) }));

export const workHubMeetingSpeakRequestsTable = pgTable("work_hub_meeting_speak_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurrenceId: uuid("occurrence_id").notNull().references(() => workHubMeetingOccurrencesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: integer("resolved_by_id").references(() => usersTable.id),
}, t => ({ pendingUnique: uniqueIndex("work_hub_meeting_speak_requests_pending_unique").on(t.occurrenceId, t.userId, t.status) }));
