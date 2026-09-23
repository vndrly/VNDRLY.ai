import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { siteLocationsTable } from "./siteLocations";
import { usersTable } from "./users";

export type CameraCredentialScope = {
  deviceStableKeys?: string[];
  channelStableKeys?: string[];
  permissions: ["view", ...string[]];
};

export const cameraGatewaysTable = pgTable(
  "camera_gateways",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteLocationId: integer("site_location_id")
      .notNull()
      .references(() => siteLocationsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"),
    softwareVersion: text("software_version"),
    playbackBaseUrl: text("playback_base_url"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    siteNameUnique: uniqueIndex("camera_gateways_site_name_unique").on(
      table.siteLocationId,
      table.name,
    ),
    siteStatusIndex: index("camera_gateways_site_status_idx").on(
      table.siteLocationId,
      table.status,
    ),
  }),
);
export const cameraCredentialReferencesTable = pgTable(
  "camera_credential_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => cameraGatewaysTable.id, { onDelete: "cascade" }),
    externalRef: text("external_ref").notNull(),
    label: text("label").notNull(),
    scope: jsonb("scope").$type<CameraCredentialScope>().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gatewayRefUnique: uniqueIndex("camera_credential_refs_gateway_ref_unique").on(
      table.gatewayId,
      table.externalRef,
    ),
  }),
);

export const cameraDevicesTable = pgTable(
  "camera_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => cameraGatewaysTable.id, { onDelete: "cascade" }),
    stableKey: text("stable_key").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    manufacturer: text("manufacturer"),
    model: text("model"),
    adapter: text("adapter").notNull(),
    protocols: jsonb("protocols").$type<Array<"onvif" | "rtsp">>().notNull().default([]),
    credentialReferenceId: uuid("credential_reference_id").references(
      () => cameraCredentialReferencesTable.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("online"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gatewayStableKeyUnique: uniqueIndex("camera_devices_gateway_stable_key_unique").on(
      table.gatewayId,
      table.stableKey,
    ),
    gatewayStatusIndex: index("camera_devices_gateway_status_idx").on(
      table.gatewayId,
      table.status,
    ),
  }),
);

export const cameraChannelsTable = pgTable(
  "camera_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => cameraDevicesTable.id, { onDelete: "cascade" }),
    stableKey: text("stable_key").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    status: text("status").notNull().default("online"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    deviceStableKeyUnique: uniqueIndex("camera_channels_device_stable_key_unique").on(
      table.deviceId,
      table.stableKey,
    ),
  }),
);

export const cameraAuditLogTable = pgTable(
  "camera_audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    siteLocationId: integer("site_location_id")
      .notNull()
      .references(() => siteLocationsTable.id, { onDelete: "cascade" }),
    actorUserId: integer("actor_user_id").references(() => usersTable.id),
    gatewayId: uuid("gateway_id").references(() => cameraGatewaysTable.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    siteCreatedIndex: index("camera_audit_log_site_created_idx").on(
      table.siteLocationId,
      table.createdAt,
    ),
  }),
);
