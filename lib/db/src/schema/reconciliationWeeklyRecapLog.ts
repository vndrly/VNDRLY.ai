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
import { vendorsTable } from "./vendors";

// Task #368 — weekly reconciliation-drift recap dedupe log.
//
// One row per (vendor, ISO week) recap email. The unique `dedupe_key`
// (`reconciliation_weekly_recap:<vendorId>:<isoWeek>`) bounds
// cross-instance races to a single delivery — losers ON CONFLICT DO
// NOTHING and skip the email side effect. `failure_message` records
// terminal-skip reasons (e.g. `no_admin_recipients`, `no_drift`) so
// operators can see why a vendor was skipped without re-running the
// worker.
export const reconciliationWeeklyRecapLogTable = pgTable(
  "reconciliation_weekly_recap_log",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    weekLabel: text("week_label").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditRowCount: integer("audit_row_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    failureMessage: text("failure_message"),
  },
  (t) => ({
    idxVendor: index("reconciliation_weekly_recap_log_vendor_idx").on(
      t.vendorId,
    ),
    uniqDedupe: uniqueIndex(
      "reconciliation_weekly_recap_log_dedupe_unique",
    ).on(t.dedupeKey),
  }),
);

export const insertReconciliationWeeklyRecapLogSchema = createInsertSchema(
  reconciliationWeeklyRecapLogTable,
).omit({ id: true });
export type InsertReconciliationWeeklyRecapLog = z.infer<
  typeof insertReconciliationWeeklyRecapLogSchema
>;
export type ReconciliationWeeklyRecapLog =
  typeof reconciliationWeeklyRecapLogTable.$inferSelect;
