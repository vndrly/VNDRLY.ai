import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";
import { usersTable } from "./users";

export const REMINDER_KINDS = ["aging", "manual"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

// Aging-worker dedupe is per (invoiceId, threshold). Manual reminders pick a
// timestamped dedupeKey at write time so repeated manual sends are allowed.
export const invoiceReminderLogTable = pgTable(
  "invoice_reminder_log",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    threshold: text("threshold"),
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentToEmail: text("sent_to_email"),
    sentByUserId: integer("sent_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    failureMessage: text("failure_message"),
    notes: text("notes"),
  },
  (t) => ({
    idxInvoice: index("invoice_reminder_log_invoice_idx").on(t.invoiceId),
    uniqDedupe: uniqueIndex("invoice_reminder_log_dedupe_unique").on(
      t.dedupeKey,
    ),
  }),
);

export const insertInvoiceReminderLogSchema = createInsertSchema(
  invoiceReminderLogTable,
).omit({ id: true });
export type InsertInvoiceReminderLog = z.infer<
  typeof insertInvoiceReminderLogSchema
>;
export type InvoiceReminderLog = typeof invoiceReminderLogTable.$inferSelect;
