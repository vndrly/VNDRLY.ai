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
import { partnersTable } from "./partners";

// Task #806 — sibling dedupe / audit log for the scheduled "year-end
// 1099-K monthly breakout" email. One row per (scope, period) successful
// claim; the `dedupe_key` UNIQUE bounds cross-instance races to a
// single delivery per period.
//
// Cadence-aware periods:
//
//   * In January (when AP staff are actively assembling year-end
//     packets) the worker sends weekly. `period_label` is the ISO
//     week label, e.g. "2026-W02".
//
//   * The rest of the year the worker sends monthly. `period_label`
//     is the calendar month, e.g. "2026-04".
//
// Encoded into the dedupe key as
//   `dashboard1099:<scope>:<scopeId>:<period_label>` so admin and
// partner sends never collide and a partner cannot receive more than
// one packet per period.
//
// `recipient_emails_csv` and `formats_csv` capture the list of
// recipients and PDF/CSV format(s) actually used at send time so
// historical audit answers "who did we email this to and how" without
// having to time-travel the settings table. `report_export_audit_ids`
// is a comma-separated list of `report_export_audit_log.id` values for
// the matching download-style entries the worker wrote (one per
// format), giving operators a click-through into the existing audit
// log when investigating a specific send.
export const dashboard1099EmailLogTable = pgTable(
  "dashboard_1099_email_log",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    partnerId: integer("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    taxYear: integer("tax_year").notNull(),
    cadence: text("cadence").notNull(), // 'weekly' | 'monthly'
    periodLabel: text("period_label").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    recipientEmailsCsv: text("recipient_emails_csv").notNull().default(""),
    formatsCsv: text("formats_csv").notNull().default(""),
    reportExportAuditIdsCsv: text("report_export_audit_ids_csv"),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    failureMessage: text("failure_message"),
  },
  (t) => ({
    idxScope: index("dashboard_1099_email_log_scope_idx").on(
      t.scope,
      t.partnerId,
      t.sentAt,
    ),
    uniqDedupe: uniqueIndex("dashboard_1099_email_log_dedupe_unique").on(
      t.dedupeKey,
    ),
  }),
);

export const insertDashboard1099EmailLogSchema = createInsertSchema(
  dashboard1099EmailLogTable,
).omit({ id: true });
export type InsertDashboard1099EmailLog = z.infer<
  typeof insertDashboard1099EmailLogSchema
>;
export type Dashboard1099EmailLog =
  typeof dashboard1099EmailLogTable.$inferSelect;
