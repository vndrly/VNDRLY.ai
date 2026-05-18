import {
  pgTable,
  serial,
  integer,
  numeric,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workTypesTable } from "./workTypes";
import { vendorsTable } from "./vendors";

export const VENDOR_WORK_TYPE_UNITS = [
  "per_hour",
  "per_day",
  "per_job",
  "lump_sum",
] as const;
export type VendorWorkTypeUnit = (typeof VENDOR_WORK_TYPE_UNITS)[number];

export const vendorWorkTypesTable = pgTable(
  "vendor_work_types",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id),
    workTypeId: integer("work_type_id")
      .notNull()
      .references(() => workTypesTable.id),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    unit: text("unit"),
    currency: text("currency").notNull().default("USD"),
    notes: text("notes"),
    // Stamped when the vendor admin confirms (in the catalog publish
    // flow) that this row's pricing reflects current authority. Reset
    // to null whenever the row is edited so the next publish forces a
    // fresh acknowledgement, even if pricing didn't change.
    priceAuthorityAcknowledgedAt: timestamp(
      "price_authority_acknowledged_at",
      { withTimezone: true },
    ),
    // Free-text reason captured the last time a vendor admin changed
    // this row's pricing via the "Change Pricing" modal on Vendor
    // Detail. Optional — stays null when no reason was supplied or
    // when the row was added/removed without a pricing edit. Acts as
    // a lightweight audit trail without a dedicated history table.
    lastPriceChangeReason: text("last_price_change_reason"),
  },
  (t) => ({
    uniqVendorWorkType: uniqueIndex("vendor_work_types_vendor_work_type_unique").on(
      t.vendorId,
      t.workTypeId,
    ),
  }),
);

export const insertVendorWorkTypeSchema = createInsertSchema(
  vendorWorkTypesTable,
).omit({ id: true });
export type InsertVendorWorkType = z.infer<typeof insertVendorWorkTypeSchema>;
export type VendorWorkType = typeof vendorWorkTypesTable.$inferSelect;
