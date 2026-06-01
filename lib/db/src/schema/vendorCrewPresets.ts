import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { usersTable } from "./users";

export const vendorCrewPresetsTable = pgTable("vendor_crew_presets", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  memberEmployeeIds: jsonb("member_employee_ids").notNull().default(sql`'[]'::jsonb`),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVendorCrewPresetSchema = createInsertSchema(vendorCrewPresetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVendorCrewPreset = z.infer<typeof insertVendorCrewPresetSchema>;
export type VendorCrewPreset = typeof vendorCrewPresetsTable.$inferSelect;
