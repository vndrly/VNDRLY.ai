import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { workTypesTable } from "./workTypes";
import { usersTable } from "./users";

export const partnerVendorWorkTypeApprovalsTable = pgTable(
  "partner_vendor_work_type_approvals",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    workTypeId: integer("work_type_id")
      .notNull()
      .references(() => workTypesTable.id, { onDelete: "cascade" }),
    approvedUnitPrice: numeric("approved_unit_price", { precision: 12, scale: 2 }),
    approvedUnit: text("approved_unit"),
    approvedCurrency: text("approved_currency").notNull().default("USD"),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedByUserId: integer("approved_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    taxTreatment: text("tax_treatment"),
  },
  (t) => ({
    uniqApproval: uniqueIndex(
      "partner_vendor_work_type_approval_unique",
    ).on(t.partnerId, t.vendorId, t.workTypeId),
  }),
);

export const insertPartnerVendorWorkTypeApprovalSchema = createInsertSchema(
  partnerVendorWorkTypeApprovalsTable,
).omit({ id: true, approvedAt: true });
export type InsertPartnerVendorWorkTypeApproval = z.infer<
  typeof insertPartnerVendorWorkTypeApprovalSchema
>;
export type PartnerVendorWorkTypeApproval =
  typeof partnerVendorWorkTypeApprovalsTable.$inferSelect;
