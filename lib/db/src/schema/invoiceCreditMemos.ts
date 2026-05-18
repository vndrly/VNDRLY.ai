import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";
import { usersTable } from "./users";

export const invoiceCreditMemosTable = pgTable(
  "invoice_credit_memos",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    createdByUserId: integer("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxInvoice: index("invoice_credit_memos_invoice_idx").on(t.invoiceId),
  }),
);

export const insertInvoiceCreditMemoSchema = createInsertSchema(
  invoiceCreditMemosTable,
).omit({ id: true, createdAt: true });
export type InsertInvoiceCreditMemo = z.infer<
  typeof insertInvoiceCreditMemoSchema
>;
export type InvoiceCreditMemo = typeof invoiceCreditMemosTable.$inferSelect;
