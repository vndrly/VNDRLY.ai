import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { siteLocationsTable } from "./siteLocations";
import { ticketsTable } from "./tickets";
import { vendorPeopleTable } from "./vendorPeople";
import { usersTable } from "./users";

export const SAFETY_EVENT_TYPES = [
  "near_miss",
  "unsafe_condition",
  "unsafe_act",
  "injury",
  "property_damage",
  "observation",
] as const;

export const SAFETY_EVENT_STATUSES = [
  "submitted",
  "under_review",
  "resolved",
  "closed",
  "duplicate",
  "denied",
] as const;

export const safetyEventsTable = pgTable(
  "safety_events",
  {
    id: serial("id").primaryKey(),
    eventNumber: text("event_number").notNull().unique(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("submitted"),
    title: text("title").notNull(),
    description: text("description"),
    siteLocationId: integer("site_location_id")
      .notNull()
      .references(() => siteLocationsTable.id),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id),
    vendorId: integer("vendor_id").references(() => vendorsTable.id),
    ticketId: integer("ticket_id").references(() => ticketsTable.id),
    fieldEmployeeId: integer("field_employee_id").references(() => vendorPeopleTable.id),
    reportedByUserId: integer("reported_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    isHighPotential: boolean("is_high_potential").notNull().default(false),
    isRecordable: boolean("is_recordable"),
    isStopWork: boolean("is_stop_work").notNull().default(false),
    siteDeactivatedAt: timestamp("site_deactivated_at", { withTimezone: true }),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    duplicateOfEventId: integer("duplicate_of_event_id"),
    deniedReason: text("denied_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: integer("closed_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerStatusCreatedIdx: index("safety_events_partner_status_created_idx").on(
      t.partnerId,
      t.status,
      t.createdAt,
    ),
    vendorStatusCreatedIdx: index("safety_events_vendor_status_created_idx").on(
      t.vendorId,
      t.status,
      t.createdAt,
    ),
    siteCreatedIdx: index("safety_events_site_created_idx").on(t.siteLocationId, t.createdAt),
    ticketIdx: index("safety_events_ticket_idx").on(t.ticketId),
  }),
);

export const safetyEventAttachmentsTable = pgTable("safety_event_attachments", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => safetyEventsTable.id, { onDelete: "cascade" }),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyEventHistoryTable = pgTable("safety_event_history", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => safetyEventsTable.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  changeType: text("change_type").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorRole: text("actor_role"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyResolutionNotesTable = pgTable("safety_resolution_notes", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => safetyEventsTable.id, { onDelete: "cascade" }),
  authorUserId: integer("author_user_id")
    .notNull()
    .references(() => usersTable.id),
  authorRole: text("author_role"),
  authorOrgSide: text("author_org_side").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyCorrectiveActionsTable = pgTable("safety_corrective_actions", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => safetyEventsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  assigneeUserId: integer("assignee_user_id").references(() => usersTable.id),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: text("status").notNull().default("open"),
  verificationPhotoPath: text("verification_photo_path"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedByUserId: integer("verified_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyTrainingModulesTable = pgTable("safety_training_modules", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  videoUrl: text("video_url").notNull(),
  requiredRoles: text("required_roles").array().notNull().default([]),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyTrainingCompletionsTable = pgTable("safety_training_completions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  moduleId: integer("module_id")
    .notNull()
    .references(() => safetyTrainingModulesTable.id, { onDelete: "cascade" }),
  watchProgressPct: integer("watch_progress_pct").notNull().default(100),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSafetyEventSchema = createInsertSchema(safetyEventsTable).omit({
  id: true,
  eventNumber: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSafetyEvent = z.infer<typeof insertSafetyEventSchema>;
export type SafetyEvent = typeof safetyEventsTable.$inferSelect;
export type SafetyResolutionNote = typeof safetyResolutionNotesTable.$inferSelect;
export type SafetyCorrectiveAction = typeof safetyCorrectiveActionsTable.$inferSelect;
export type SafetyTrainingModule = typeof safetyTrainingModulesTable.$inferSelect;
