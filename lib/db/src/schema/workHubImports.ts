import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const workHubImportBatchesTable = pgTable(
  "work_hub_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerOrgType: text("owner_org_type").notNull(),
    ownerOrgId: integer("owner_org_id").notNull(),
    provider: text("provider").notNull().default("microsoft_365"),
    direction: text("direction").notNull().default("microsoft_to_vndrly"),
    status: text("status").notNull().default("preview"),
    categories: text("categories").array().notNull(),
    requestedById: integer("requested_by_id")
      .notNull()
      .references(() => usersTable.id),
    reviewedById: integer("reviewed_by_id").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorSummary: jsonb("error_summary").$type<Record<string, unknown>>(),
  },
  (t) => ({
    ownerCreatedIdx: index("work_hub_import_batches_owner_created_idx").on(
      t.ownerOrgType,
      t.ownerOrgId,
      t.createdAt,
    ),
  }),
);

export const workHubImportItemsTable = pgTable(
  "work_hub_import_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => workHubImportBatchesTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    externalId: text("external_id").notNull(),
    externalVersion: text("external_version"),
    sourceUrl: text("source_url"),
    sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    status: text("status").notNull().default("staged"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    permissionMapping:
      jsonb("permission_mapping").$type<Record<string, unknown>>(),
    conflict: jsonb("conflict").$type<Record<string, unknown>>(),
    activatedSubjectType: text("activated_subject_type"),
    activatedSubjectId: text("activated_subject_id"),
    error: jsonb("error").$type<Record<string, unknown>>(),
  },
  (t) => ({
    providerItemUnique: uniqueIndex(
      "work_hub_import_items_provider_item_unique",
    ).on(t.category, t.externalId, t.externalVersion),
    batchIdx: index("work_hub_import_items_batch_idx").on(t.batchId, t.status),
  }),
);
