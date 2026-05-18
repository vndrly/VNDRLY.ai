import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { fieldEmployeesTable } from "./vendorPeople";

export const fieldEmployeeNotesTable = pgTable("field_employee_notes", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => fieldEmployeesTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFieldEmployeeNoteSchema = createInsertSchema(fieldEmployeeNotesTable).omit({ id: true, createdAt: true });
export type InsertFieldEmployeeNote = z.infer<typeof insertFieldEmployeeNoteSchema>;
export type FieldEmployeeNote = typeof fieldEmployeeNotesTable.$inferSelect;
