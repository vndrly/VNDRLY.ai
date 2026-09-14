import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { siteLocationsTable } from "./siteLocations";
import { workHubMeetingOccurrencesTable } from "./workHubMeetings";
import { workHubDevicesTable } from "./workHubDevices";

export type OperationsDisplayView = "crew_map" | "gate_log" | "safety" | "coverage" | "meeting_room";

export const operationsDisplaysTable = pgTable("operations_displays", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerOrgType: text("owner_org_type").notNull(),
  ownerOrgId: integer("owner_org_id").notNull(),
  name: text("name").notNull(),
  identityKind: text("identity_kind").notNull().default("operations_display"),
  registeredByUserId: integer("registered_by_user_id").notNull().references(() => usersTable.id),
  registeredCompanionDeviceId: uuid("registered_companion_device_id").notNull().references(() => workHubDevicesTable.id),
  siteAllowlist: jsonb("site_allowlist").$type<number[]>().notNull().default([]),
  viewAllowlist: jsonb("view_allowlist").$type<OperationsDisplayView[]>().notNull().default([]),
  privacyMode: boolean("privacy_mode").notNull().default(true),
  tokenHash: text("token_hash").notNull(),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: integer("revoked_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ ownerIdx: index("operations_displays_owner_idx").on(t.ownerOrgType, t.ownerOrgId) }));

export const operationsDisplayOutputsTable = pgTable("operations_display_outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayId: uuid("display_id").notNull().references(() => operationsDisplaysTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  currentView: text("current_view").$type<OperationsDisplayView>(),
  currentSiteLocationId: integer("current_site_location_id").references(() => siteLocationsTable.id),
  currentMeetingOccurrenceId: uuid("current_meeting_occurrence_id").references(() => workHubMeetingOccurrencesTable.id),
  cameraEnabled: boolean("camera_enabled").notNull().default(false),
  microphoneEnabled: boolean("microphone_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ displayNameUnique: uniqueIndex("operations_display_outputs_display_name_unique").on(t.displayId, t.name) }));
