import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const assetsTable = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  legalOwnerName: text("legal_owner_name").notNull(),
  responsibleOrgType: text("responsible_org_type").notNull(),
  responsibleOrgId: integer("responsible_org_id").notNull(),
  currentLocationType: text("current_location_type"),
  currentLocationId: text("current_location_id"),
  currentHolderUserId: integer("current_holder_user_id").references(() => usersTable.id),
  expectedReturnAt: timestamp("expected_return_at", { withTimezone: true }),
  manufacturer: text("manufacturer"),
  model: text("model"),
  status: text("status").notNull().default("available"),
  provisional: boolean("provisional").notNull().default(false),
  mergedIntoId: uuid("merged_into_id"),
  version: integer("version").notNull().default(1),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (table) => ({ responsibleIdx: index("assets_responsible_owner_idx").on(table.responsibleOrgType, table.responsibleOrgId, table.status) }));

export const assetAliasesTable = pgTable("asset_aliases", {
  id: uuid("id").primaryKey().defaultRandom(), assetId: uuid("asset_id").notNull().references(() => assetsTable.id), kind: text("kind").notNull(), jurisdiction: text("jurisdiction").notNull().default(""), normalizedValue: text("normalized_value").notNull(), displayValue: text("display_value").notNull(), active: boolean("active").notNull().default(true), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (table) => ({ lookupUnique: uniqueIndex("asset_alias_lookup_unique").on(table.kind, table.jurisdiction, table.normalizedValue), assetIdx: index("asset_alias_asset_idx").on(table.assetId) }));

export const assetCategoryPoliciesTable = pgTable("asset_category_policies", {
  id: uuid("id").primaryKey().defaultRandom(), ownerOrgType: text("owner_org_type").notNull(), ownerOrgId: integer("owner_org_id").notNull(), category: text("category").notNull(), identifierRequired: boolean("identifier_required").notNull().default(false), photosRequiredOnCheckout: boolean("photos_required_on_checkout").notNull().default(false), photosRequiredOnReturn: boolean("photos_required_on_return").notNull().default(false), supervisorApprovalRequired: boolean("supervisor_approval_required").notNull().default(false), expectedReturnRequired: boolean("expected_return_required").notNull().default(false), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ ownerCategoryUnique: uniqueIndex("asset_category_policy_owner_unique").on(table.ownerOrgType, table.ownerOrgId, table.category) }));

export const assetCustodyEventsTable = pgTable("asset_custody_events", {
  id: uuid("id").primaryKey().defaultRandom(), assetId: uuid("asset_id").notNull().references(() => assetsTable.id), eventType: text("event_type").notNull(), fromHolderUserId: integer("from_holder_user_id").references(() => usersTable.id), toHolderUserId: integer("to_holder_user_id").references(() => usersTable.id), condition: text("condition"), note: text("note"), actorUserId: integer("actor_user_id").references(() => usersTable.id), operationId: uuid("operation_id").notNull(), assetVersion: integer("asset_version").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  commandFingerprint: text("command_fingerprint"),
}, (table) => ({ operationUnique: uniqueIndex("asset_custody_operation_unique").on(table.operationId), assetHistoryIdx: index("asset_custody_history_idx").on(table.assetId, table.occurredAt) }));

export const assetConditionEvidenceTable = pgTable("asset_condition_evidence", {
  id: uuid("id").primaryKey().defaultRandom(), assetId: uuid("asset_id").notNull().references(() => assetsTable.id), custodyEventId: uuid("custody_event_id").references(() => assetCustodyEventsTable.id), condition: text("condition"), note: text("note"), photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]), reportedByUserId: integer("reported_by_user_id").references(() => usersTable.id), reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assetHoldsTable = pgTable("asset_holds", {
  id: uuid("id").primaryKey().defaultRandom(), assetId: uuid("asset_id").notNull().references(() => assetsTable.id), reason: text("reason").notNull(), placedByUserId: integer("placed_by_user_id").references(() => usersTable.id), placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(), releasedByUserId: integer("released_by_user_id").references(() => usersTable.id), releasedAt: timestamp("released_at", { withTimezone: true }),
}, (table) => ({ assetIdx: index("asset_hold_asset_idx").on(table.assetId, table.releasedAt) }));

export const assetMergesTable = pgTable("asset_merges", {
  id: uuid("id").primaryKey().defaultRandom(), survivingAssetId: uuid("surviving_asset_id").notNull().references(() => assetsTable.id), mergedAssetId: uuid("merged_asset_id").notNull().references(() => assetsTable.id), reason: text("reason").notNull(), mergedByUserId: integer("merged_by_user_id").references(() => usersTable.id), mergedAt: timestamp("merged_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ mergedUnique: uniqueIndex("asset_merge_source_unique").on(table.mergedAssetId) }));

export const assetAttachmentLinksTable = pgTable("asset_attachment_links", {
  id: uuid("id").primaryKey().defaultRandom(), assetId: uuid("asset_id").notNull().references(() => assetsTable.id), attachmentType: text("attachment_type").notNull(), attachmentId: text("attachment_id").notNull(), linkedByUserId: integer("linked_by_user_id").references(() => usersTable.id), linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ assetAttachmentUnique: uniqueIndex("asset_attachment_unique").on(table.assetId, table.attachmentType, table.attachmentId) }));
