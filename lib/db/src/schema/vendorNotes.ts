import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";

export const vendorNotesTable = pgTable("vendor_notes", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVendorNoteSchema = createInsertSchema(vendorNotesTable).omit({ id: true, createdAt: true });
export type InsertVendorNote = z.infer<typeof insertVendorNoteSchema>;
export type VendorNote = typeof vendorNotesTable.$inferSelect;
