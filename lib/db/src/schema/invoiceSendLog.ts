import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";
import { usersTable } from "./users";

export const invoiceSendLogTable = pgTable(
  "invoice_send_log",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentToEmail: text("sent_to_email").notNull(),
    sentByUserId: integer("sent_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    sendgridMessageId: text("sendgrid_message_id"),
    pdfBytes: integer("pdf_bytes"),
    failureMessage: text("failure_message"),
  },
  (t) => ({
    idxInvoice: index("invoice_send_log_invoice_idx").on(t.invoiceId),
  }),
);

export const insertInvoiceSendLogSchema = createInsertSchema(
  invoiceSendLogTable,
).omit({ id: true });
export type InsertInvoiceSendLog = z.infer<typeof insertInvoiceSendLogSchema>;
export type InvoiceSendLog = typeof invoiceSendLogTable.$inferSelect;
