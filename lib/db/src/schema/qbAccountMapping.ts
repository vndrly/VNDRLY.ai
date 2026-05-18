import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { partnersTable } from "./partners";

export const qbAccountMappingTable = pgTable(
  "qb_account_mapping",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id").references(() => vendorsTable.id, {
      onDelete: "cascade",
    }),
    partnerId: integer("partner_id").references(() => partnersTable.id, {
      onDelete: "cascade",
    }),
    lineType: text("line_type").notNull(),
    accountName: text("account_name").notNull(),
    accountNumber: text("account_number"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqScopeLineType: uniqueIndex("qb_account_mapping_scope_line_type").on(
      t.vendorId,
      t.partnerId,
      t.lineType,
    ),
  }),
);

export const insertQbAccountMappingSchema = createInsertSchema(
  qbAccountMappingTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQbAccountMapping = z.infer<typeof insertQbAccountMappingSchema>;
export type QbAccountMapping = typeof qbAccountMappingTable.$inferSelect;
