import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

// Task #806 — opt-in configuration for the scheduled "year-end 1099-K
// monthly breakout" email. One row per scope:
//
//   * `scope = 'admin'` — admin-wide subscription. There is at most one
//     row of this kind (enforced by the partial unique index below).
//     `partner_id` is NULL on this row; the worker emails the
//     all-payers (admin) breakout to the configured recipients.
//
//   * `scope = 'partner'` — per-partner subscription. `partner_id` is
//     the FK and is unique among partner-scoped rows so admins (or the
//     partner itself) can opt that partner in/out independently.
//
// `formats` is a CSV-encoded subset of {"pdf", "csv"} so admins can
// pick PDF only (paper-style packet), CSV only (spreadsheet), or both.
// We store it as a `text` column (comma-separated) to keep the schema
// portable across drivers; the column always holds a non-empty value
// once `enabled = true`. `recipient_emails` is similarly stored as a
// newline-separated text blob — the application splits/normalizes on
// read/write so we don't depend on Postgres array support.
//
// `tax_year_override` lets the admin pin a specific year; when null,
// the worker uses the prior calendar year (the natural "year-end packet"
// audience). This is rarely set in practice but useful for catch-up
// sends after a fiscal-year reopen.
export const DASHBOARD_1099_EMAIL_SCOPES = ["admin", "partner"] as const;
export type Dashboard1099EmailScope =
  (typeof DASHBOARD_1099_EMAIL_SCOPES)[number];

export const DASHBOARD_1099_EMAIL_FORMATS = ["pdf", "csv"] as const;
export type Dashboard1099EmailFormat =
  (typeof DASHBOARD_1099_EMAIL_FORMATS)[number];

export const dashboard1099EmailSettingsTable = pgTable(
  "dashboard_1099_email_settings",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    partnerId: integer("partner_id").references(() => partnersTable.id, {
      onDelete: "cascade",
    }),
    enabled: boolean("enabled").notNull().default(false),
    // Comma-separated subset of {"pdf","csv"}. Always non-empty when enabled.
    formats: text("formats").notNull().default("pdf"),
    // Newline-separated list of recipient email addresses. Empty string =
    // no recipients configured (worker will skip with `no_recipients`).
    recipientEmails: text("recipient_emails").notNull().default(""),
    // Optional override for the tax year the worker emails. NULL means
    // "use the prior calendar year" each run.
    taxYearOverride: integer("tax_year_override"),
    updatedByUserId: integer("updated_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Only one admin-scoped row may exist.
    uniqAdmin: uniqueIndex("dashboard_1099_email_settings_admin_unique")
      .on(t.scope)
      .where(sql`${t.scope} = 'admin'`),
    // One row per partner_id for partner-scoped rows.
    uniqPartner: uniqueIndex(
      "dashboard_1099_email_settings_partner_unique",
    )
      .on(t.partnerId)
      .where(sql`${t.scope} = 'partner' and ${t.partnerId} is not null`),
    idxEnabled: index("dashboard_1099_email_settings_enabled_idx").on(
      t.enabled,
    ),
  }),
);

export const insertDashboard1099EmailSettingsSchema = createInsertSchema(
  dashboard1099EmailSettingsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDashboard1099EmailSettings = z.infer<
  typeof insertDashboard1099EmailSettingsSchema
>;
export type Dashboard1099EmailSettings =
  typeof dashboard1099EmailSettingsTable.$inferSelect;
