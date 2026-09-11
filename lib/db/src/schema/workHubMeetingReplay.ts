import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubMeetingOccurrencesTable } from "./workHubMeetings";

export const workHubMeetingReplayManifestsTable = pgTable("work_hub_meeting_replay_manifests", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurrenceId: uuid("occurrence_id").notNull().references(() => workHubMeetingOccurrencesTable.id),
  ownerOrgType: text("owner_org_type").notNull(), ownerOrgId: integer("owner_org_id").notNull(),
  recordingOwnerUserId: integer("recording_owner_user_id").notNull().references(() => usersTable.id),
  recordingLeaseGeneration: integer("recording_lease_generation").notNull().default(0), recordingLeaseTokenHash: varchar("recording_lease_token_hash", { length: 64 }),
  recordingLeaseHolderUserId: integer("recording_lease_holder_user_id").references(() => usersTable.id), recordingLeaseIssuedAt: timestamp("recording_lease_issued_at", { withTimezone: true }), recordingLeaseExpiresAt: timestamp("recording_lease_expires_at", { withTimezone: true }),
  meetingStartedAt: timestamp("meeting_started_at", { withTimezone: true }).notNull(), meetingEndedAt: timestamp("meeting_ended_at", { withTimezone: true }),
  status: text("status").notNull().default("recording"), schemaVersion: integer("schema_version").notNull().default(2), rendererVersion: integer("renderer_version").notNull().default(1), durationMs: integer("duration_ms"),
  gapMarkers: jsonb("gap_markers").$type<Array<{ startsAtMs: number; endsAtMs: number; reason: string }>>().notNull().default([]),
  audioByteCount: bigint("audio_byte_count", { mode: "number" }).notNull().default(0), audioChunkCount: integer("audio_chunk_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  occurrenceUnique: uniqueIndex("work_hub_meeting_replay_manifest_occurrence_unique").on(table.occurrenceId), ownerCursor: index("work_hub_meeting_replay_manifest_owner_idx").on(table.ownerOrgType, table.ownerOrgId, table.createdAt, table.id),
  statusCheck: check("work_hub_meeting_replay_manifest_status_check", sql`${table.status} IN ('recording','finalized')`),
  valuesCheck: check("work_hub_meeting_replay_manifest_values_check", sql`${table.schemaVersion} > 0 AND ${table.rendererVersion} > 0 AND ${table.recordingLeaseGeneration} >= 0 AND (${table.durationMs} IS NULL OR ${table.durationMs} > 0) AND ${table.audioByteCount} >= 0 AND ${table.audioChunkCount} >= 0`),
}));

export const workHubMeetingReplayAudioChunksTable = pgTable("work_hub_meeting_replay_audio_chunks", {
  id: uuid("id").primaryKey(), manifestId: uuid("manifest_id").notNull().references(() => workHubMeetingReplayManifestsTable.id), occurrenceId: uuid("occurrence_id").notNull().references(() => workHubMeetingOccurrencesTable.id),
  operationId: uuid("operation_id").notNull(), leaseGeneration: integer("lease_generation").notNull(), sequence: integer("sequence").notNull(), startsAtMs: integer("starts_at_ms").notNull(), endsAtMs: integer("ends_at_ms").notNull(),
  durationMs: integer("duration_ms").notNull(), sampleRate: integer("sample_rate").notNull(), channelCount: integer("channel_count").notNull(), bitsPerSample: integer("bits_per_sample").notNull(), sampleCount: integer("sample_count").notNull(),
  contentType: varchar("content_type", { length: 80 }).notNull(), byteSize: integer("byte_size").notNull(), sha256: varchar("sha256", { length: 64 }).notNull(), storageKey: text("storage_key").notNull(), state: text("state").notNull().default("pending"),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  operationUnique: uniqueIndex("work_hub_meeting_replay_chunk_operation_unique").on(table.manifestId, table.operationId), sequenceUnique: uniqueIndex("work_hub_meeting_replay_chunk_sequence_unique").on(table.manifestId, table.sequence), timeline: index("work_hub_meeting_replay_chunk_timeline_idx").on(table.manifestId, table.startsAtMs, table.id),
  stateCheck: check("work_hub_meeting_replay_chunk_state_check", sql`${table.state} IN ('pending','ready','failed')`), valuesCheck: check("work_hub_meeting_replay_chunk_values_check", sql`${table.sequence} >= 0 AND ${table.startsAtMs} >= 0 AND ${table.endsAtMs} > ${table.startsAtMs} AND ${table.durationMs} = ${table.endsAtMs} - ${table.startsAtMs} AND ${table.sampleRate} >= 8000 AND ${table.sampleRate} <= 48000 AND ${table.channelCount} = 1 AND ${table.bitsPerSample} = 16 AND ${table.sampleCount} > 0 AND ${table.byteSize} > 0 AND ${table.byteSize} <= 5242880 AND char_length(${table.sha256}) = 64`),
}));

export const workHubMeetingReplayEventsTable = pgTable("work_hub_meeting_replay_events", {
  id: uuid("id").primaryKey().defaultRandom(), manifestId: uuid("manifest_id").notNull().references(() => workHubMeetingReplayManifestsTable.id), occurrenceId: uuid("occurrence_id").notNull().references(() => workHubMeetingOccurrencesTable.id),
  operationId: uuid("operation_id").notNull(), leaseGeneration: integer("lease_generation").notNull(), eventKey: varchar("event_key", { length: 160 }).notNull(), eventType: text("event_type").notNull(), offsetMs: integer("offset_ms").notNull(), endOffsetMs: integer("end_offset_ms"),
  sourceId: uuid("source_id"), actorUserId: integer("actor_user_id").references(() => usersTable.id), payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}), createdById: integer("created_by_id").notNull().references(() => usersTable.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  operationUnique: uniqueIndex("work_hub_meeting_replay_event_operation_unique").on(table.manifestId, table.operationId), eventKeyUnique: uniqueIndex("work_hub_meeting_replay_event_key_unique").on(table.manifestId, table.eventKey), timeline: index("work_hub_meeting_replay_event_timeline_idx").on(table.manifestId, table.offsetMs, table.id),
  typeCheck: check("work_hub_meeting_replay_event_type_check", sql`${table.eventType} IN ('transcript','message','file','askv_answer','speaker','activity','gap')`), valuesCheck: check("work_hub_meeting_replay_event_values_check", sql`${table.offsetMs} >= 0 AND (${table.endOffsetMs} IS NULL OR ${table.endOffsetMs} >= ${table.offsetMs})`),
}));

export const workHubMeetingReplayAssignmentsTable = pgTable("work_hub_meeting_replay_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurrenceId: uuid("occurrence_id").notNull().references(() => workHubMeetingOccurrencesTable.id),
  assigneeUserId: integer("assignee_user_id").notNull().references(() => usersTable.id),
  assignedById: integer("assigned_by_id").notNull().references(() => usersTable.id),
  requirement: text("requirement").notNull().default("optional"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: text("status").notNull().default("not_started"),
  watchedIntervals: jsonb("watched_intervals").$type<Array<{ startsAtMs: number; endsAtMs: number }>>().notNull().default([]),
  watchedMs: integer("watched_ms").notNull().default(0),
  lastPositionMs: integer("last_position_ms").notNull().default(0),
  viewerGeneration: integer("viewer_generation").notNull().default(0),
  viewerTokenHash: varchar("viewer_token_hash", { length: 64 }),
  viewerIssuedAt: timestamp("viewer_issued_at", { withTimezone: true }),
  viewerExpiresAt: timestamp("viewer_expires_at", { withTimezone: true }),
  viewerObservedAt: timestamp("viewer_observed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  occurrenceAssigneeUnique: uniqueIndex("work_hub_meeting_replay_assignment_unique").on(table.occurrenceId, table.assigneeUserId),
  assigneeCursor: index("work_hub_meeting_replay_assignment_assignee_idx").on(table.assigneeUserId, table.status, table.dueAt, table.id),
  requirementCheck: check("work_hub_meeting_replay_assignment_requirement_check", sql`${table.requirement} IN ('optional','required')`),
  statusCheck: check("work_hub_meeting_replay_assignment_status_check", sql`${table.status} IN ('not_started','in_progress','completed')`),
  valuesCheck: check("work_hub_meeting_replay_assignment_values_check", sql`${table.watchedMs} >= 0 AND ${table.lastPositionMs} >= 0 AND ${table.viewerGeneration} >= 0`),
}));
