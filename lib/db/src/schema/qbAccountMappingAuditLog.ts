import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";
import { partnersTable } from "./partners";

// Audit trail of every create / update / delete applied to
// `qb_account_mapping`. The mapping table itself is mutated in place by the
// admin Settings UI (PUT upserts, DELETE reverts to the built-in default), so
// without an explicit log there's no record of who routed an export to which
// QuickBooks account or when. Surfaced in Reports → Settings so finance leads
// can review recent mapping changes when an export ends up in the wrong
// account.
//
// `oldValues` / `newValues` are stored as opaque jsonb. For an INSERT we
// record only `newValues`; for a DELETE only `oldValues`; for an UPDATE both,
// limited to the fields the upsert handler can change (accountName,
// accountNumber). We keep the scope columns (vendorId / partnerId / lineType)
// hoisted out of the JSON blob so admins can filter / index by them later
// without having to dig into jsonb.
export const QB_ACCOUNT_MAPPING_AUDIT_ACTIONS = [
  "insert",
  "update",
  "delete",
] as const;
export type QbAccountMappingAuditAction =
  (typeof QB_ACCOUNT_MAPPING_AUDIT_ACTIONS)[number];

export const qbAccountMappingAuditLogTable = pgTable(
  "qb_account_mapping_audit_log",
  {
    id: serial("id").primaryKey(),
    action: text("action").notNull(),
    // The mapping row id this audit entry refers to. For a DELETE this id no
    // longer exists in qb_account_mapping (the row was removed); we keep the
    // FK out so historical rows survive the cascade.
    mappingId: integer("mapping_id"),
    vendorId: integer("vendor_id").references(() => vendorsTable.id, {
      onDelete: "set null",
    }),
    partnerId: integer("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    lineType: text("line_type").notNull(),
    oldValues: jsonb("old_values").$type<Record<string, unknown>>(),
    newValues: jsonb("new_values").$type<Record<string, unknown>>(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxCreatedAt: index("qb_account_mapping_audit_created_idx").on(t.createdAt),
    idxLineType: index("qb_account_mapping_audit_line_type_idx").on(
      t.lineType,
      t.createdAt,
    ),
    // Filter indexes for the admin Reports → Settings audit card. Each
    // pairs the filter column with createdAt so the route's
    // ORDER BY created_at DESC LIMIT/OFFSET stays index-backed even when
    // an admin narrows by vendor / partner / actor.
    idxVendor: index("qb_account_mapping_audit_vendor_idx").on(
      t.vendorId,
      t.createdAt,
    ),
    idxPartner: index("qb_account_mapping_audit_partner_idx").on(
      t.partnerId,
      t.createdAt,
    ),
    idxActor: index("qb_account_mapping_audit_actor_idx").on(
      t.actorUserId,
      t.createdAt,
    ),
  }),
);

export const insertQbAccountMappingAuditLogSchema = createInsertSchema(
  qbAccountMappingAuditLogTable,
).omit({ id: true, createdAt: true });
export type InsertQbAccountMappingAuditLog = z.infer<
  typeof insertQbAccountMappingAuditLogSchema
>;
export type QbAccountMappingAuditLog =
  typeof qbAccountMappingAuditLogTable.$inferSelect;
