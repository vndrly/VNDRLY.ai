import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

export const ticketNoteLogsTable = pgTable("ticket_note_logs", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  attachments: text("attachments").array(),
  mentions: integer("mentions").array(),
  editHistory: jsonb("edit_history"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedById: integer("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketNoteLogSchema = createInsertSchema(ticketNoteLogsTable).omit({ id: true, createdAt: true });
export type InsertTicketNoteLog = z.infer<typeof insertTicketNoteLogSchema>;
export type TicketNoteLog = typeof ticketNoteLogsTable.$inferSelect;
