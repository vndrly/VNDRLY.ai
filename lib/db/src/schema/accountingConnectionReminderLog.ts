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
import { accountingConnectionsTable } from "./accountingConnections";

// Task #248 — accounting connection reminder dedupe log.
//
// One row per (connection, reason, occurrence) reminder fired by the
// daily OA connection reminder worker. The unique `dedupe_key`
// guarantees that the same (connection, status snapshot) pair never
// produces more than one delivered reminder, even across worker
// restarts or repeated daily runs.
//
// Reasons:
//   • "revoked"        — connection.status = 'revoked'. Dedupe per
//                        connection+updated_at epoch so a re-revoked
//                        connection (after a successful reconnect)
//                        gets a fresh reminder.
//   • "expiring_soon"  — connection still active but the OAuth refresh
//                        appears stale (access_token_expires_at in the
//                        past with no recent updated_at). Dedupe per
//                        connection+YYYYMM so the worker re-nudges
//                        once a month if the connection stays stale.
//
// Retry semantics mirror the certification-reminder log: if the digest
// send fails after a successful claim, `failure_message` is populated
// so the next scan re-attempts delivery without re-claiming the row.
export const accountingConnectionReminderLogTable = pgTable(
  "accounting_connection_reminder_log",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => accountingConnectionsTable.id, {
        onDelete: "cascade",
      }),
    // "revoked" | "expiring_soon"
    reason: text("reason").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Number of recipients the reminder was delivered to (in-app +
    // email combined). Diagnostic only.
    recipientCount: integer("recipient_count").notNull().default(0),
    failureMessage: text("failure_message"),
  },
  (t) => ({
    idxConn: index("accounting_conn_reminder_log_conn_idx").on(t.connectionId),
    uniqDedupe: uniqueIndex(
      "accounting_conn_reminder_log_dedupe_unique",
    ).on(t.dedupeKey),
  }),
);

export const insertAccountingConnectionReminderLogSchema = createInsertSchema(
  accountingConnectionReminderLogTable,
).omit({ id: true });
export type InsertAccountingConnectionReminderLog = z.infer<
  typeof insertAccountingConnectionReminderLogSchema
>;
export type AccountingConnectionReminderLog =
  typeof accountingConnectionReminderLogTable.$inferSelect;
