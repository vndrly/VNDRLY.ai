import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workHubMeetingOccurrencesTable } from "./workHubMeetings";
import { workHubMeetingReplayManifestsTable } from "./workHubMeetingReplay";

export const workHubMeetingParticipationAuthorizationsTable = pgTable(
  "work_hub_meeting_participation_authorizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    policyVersion: integer("policy_version").notNull(),
    source: text("source").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({ userPolicyUnique: uniqueIndex("work_hub_meeting_participation_authorization_unique").on(t.userId, t.policyVersion) }),
);

export const workHubMeetingRecordingRetentionTable = pgTable(
  "work_hub_meeting_recording_retention",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    manifestId: uuid("manifest_id").notNull().references(() => workHubMeetingReplayManifestsTable.id, { onDelete: "cascade" }),
    occurrenceId: uuid("occurrence_id").notNull().references(() => workHubMeetingOccurrencesTable.id, { onDelete: "cascade" }),
    retentionDays: integer("retention_days").notNull().default(30),
    rawMediaExpiresAt: timestamp("raw_media_expires_at", { withTimezone: true }).notNull(),
    rawMediaDeletedAt: timestamp("raw_media_deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ manifestUnique: uniqueIndex("work_hub_meeting_recording_retention_manifest_unique").on(t.manifestId), expiryIdx: index("work_hub_meeting_recording_retention_expiry_idx").on(t.rawMediaExpiresAt, t.rawMediaDeletedAt) }),
);

export const workHubMeetingRecordingHoldsTable = pgTable(
  "work_hub_meeting_recording_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    retentionId: uuid("retention_id").notNull().references(() => workHubMeetingRecordingRetentionTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    placedByUserId: integer("placed_by_user_id").notNull().references(() => usersTable.id),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    releasedByUserId: integer("released_by_user_id").references(() => usersTable.id),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => ({ activeHoldIdx: index("work_hub_meeting_recording_hold_active_idx").on(t.retentionId, t.releasedAt) }),
);
