import {
  pgTable,
  serial,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { invoicesTable } from "./invoices";
import { ticketsTable } from "./tickets";

// Inputs the engine used at generation time. Shape mirrors EngineSnapshot in
// artifacts/api-server/src/lib/invoice-engine.ts (kept duck-typed here to
// avoid an api-server → db dependency cycle).
export type InvoiceRateCardSnapshotData = {
  vendorId: number;
  partnerId: number;
  siteId: number;
  siteState: string | null;
  taxRate: string | null;
  taxRateSource: string;
  overtimeMultiplier: string;
  dailyOtHours: string;
  weeklyOtHours: string;
  rateLookups: Array<{
    employeeId: number;
    rate: string;
    source: "ticket_check_ins" | "ticket_assignment_rates" | "fallback_zero";
  }>;
  capturedAt: string;
  engineVersion: string;
};

// APPEND-ONLY audit log. Each generation event for a (invoice, ticket) pair
// inserts a NEW row — prior rows are never updated or replaced. The detail
// endpoint exposes the full history so multi-ticket invoices retain the
// per-ticket inputs (rates, tax rate, OT thresholds, etc.) used at generation
// time, not just the last ticket processed. ticketId is nullable for
// backwards compatibility with rows written before this column existed.
export const invoiceRateCardSnapshotsTable = pgTable(
  "invoice_rate_card_snapshots",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    ticketId: integer("ticket_id").references(() => ticketsTable.id, {
      onDelete: "cascade",
    }),
    snapshot: jsonb("snapshot").$type<InvoiceRateCardSnapshotData>().notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    invoiceCapturedIdx: index("invoice_rate_card_snapshot_invoice_idx").on(
      t.invoiceId,
      t.capturedAt,
    ),
  }),
);

export type InvoiceRateCardSnapshot =
  typeof invoiceRateCardSnapshotsTable.$inferSelect;
