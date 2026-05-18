import { pgTable, serial, integer, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { workTypesTable } from "./workTypes";

export const partnerWorkTypeAfesTable = pgTable(
  "partner_work_type_afes",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    workTypeId: integer("work_type_id")
      .notNull()
      .references(() => workTypesTable.id, { onDelete: "cascade" }),
    afe: text("afe").notNull(),
  },
  (t) => ({
    partnerWorkTypeUnique: uniqueIndex("partner_work_type_afe_unique").on(
      t.partnerId,
      t.workTypeId,
    ),
  }),
);

export const insertPartnerWorkTypeAfeSchema = createInsertSchema(
  partnerWorkTypeAfesTable,
).omit({ id: true });
export type InsertPartnerWorkTypeAfe = z.infer<typeof insertPartnerWorkTypeAfeSchema>;
export type PartnerWorkTypeAfe = typeof partnerWorkTypeAfesTable.$inferSelect;
