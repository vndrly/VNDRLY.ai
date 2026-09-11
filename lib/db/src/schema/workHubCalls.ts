import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubMeetingOccurrencesTable } from "./workHubMeetings";
export const workHubCallsTable = pgTable("work_hub_calls", {
  id: uuid("id").primaryKey().defaultRandom(), callerUserId: integer("caller_user_id").notNull().references(() => usersTable.id), recipientUserId: integer("recipient_user_id").notNull().references(() => usersTable.id),
  occurrenceId: uuid("occurrence_id").notNull().references(() => workHubMeetingOccurrencesTable.id), status: text("status").notNull().default("ringing"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), answeredAt: timestamp("answered_at", { withTimezone: true }), endedAt: timestamp("ended_at", { withTimezone: true }),
});
export const workHubVoicemailTable = pgTable("work_hub_voicemail", {
  id: uuid("id").primaryKey(), callId: uuid("call_id").notNull().references(() => workHubCallsTable.id), recipientUserId: integer("recipient_user_id").notNull().references(() => usersTable.id), senderUserId: integer("sender_user_id").notNull().references(() => usersTable.id),
  storageKey: text("storage_key").notNull(), contentType: text("content_type").notNull(), durationMs: integer("duration_ms").notNull(), transcript: text("transcript"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), readAt: timestamp("read_at", { withTimezone: true }), deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
export const workHubCallSettingsTable = pgTable("work_hub_call_settings", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id), available: boolean("available").notNull().default(true), speedDial: jsonb("speed_dial").$type<number[]>().notNull().default([]),
});
