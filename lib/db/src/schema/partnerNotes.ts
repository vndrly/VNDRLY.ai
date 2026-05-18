import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";

export const partnerNotesTable = pgTable("partner_notes", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPartnerNoteSchema = createInsertSchema(partnerNotesTable).omit({ id: true, createdAt: true });
export type InsertPartnerNote = z.infer<typeof insertPartnerNoteSchema>;
export type PartnerNote = typeof partnerNotesTable.$inferSelect;
