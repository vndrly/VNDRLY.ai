import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Phase 4 audit log. Every external download (CSV / PDF / IIF / zip / 1099)
// produced by the Reports tab writes one row here. JSON-shaped on-screen
// previews are intentionally NOT audited — they don't leave the app and the
// noise would drown the externally-shareable artifacts in this table.
//
// `scope` is a free-form jsonb describing the parameters used to build the
// download (e.g. { vendorId, partnerId, year, periodStart, periodEnd }) so
// that "who downloaded what for which period" can be answered without joining
// a half-dozen parameter tables. We deliberately store this as opaque JSON
// rather than columns: report kinds vary in shape and we'd rather not migrate
// every time a new report is added.
//
// `detailJson` carries large-payload, after-the-fact details that don't belong
// in `scope` (which is filter input). Today this is the structured `warnings`
// list returned by accounting pushes — { kind, identifier, message }[] — so
// admins can see exactly which rows failed for a given push and re-sync just
// those rows. Stays nullable because the great majority of audit rows
// (downloads) have nothing extra to record.
export const REPORT_EXPORT_FORMATS = [
  "csv",
  "pdf",
  "iif",
  "qbo_zip",
  "oa_zip",
  "accounting_bundle_zip",
  "1099_csv",
  "1099_pdf",
  // Live API pushes — no file is downloaded but we still record one row
  // per push so "who synced what for which period" is auditable.
  "qbo_api_push",
  "oa_api_push",
  // Per-invoice re-syncs use the same channels but update the existing
  // remote invoice in place instead of creating a new one. They get
  // their own format values so admins can filter "bulk push" vs
  // "one-off correction" in the audit history.
  "qbo_api_resync",
  "oa_api_resync",
  // "Forget push record" — admin clears the local mapping row so the
  // next bulk push will re-create the invoice in QBO/OA. No remote API
  // call is made (the row is just deleted locally), but we still
  // record one audit entry so deletes are traceable in the audit log.
  "qbo_api_forget",
  "oa_api_forget",
  "1099_fire_txt",
] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export const reportExportAuditLogTable = pgTable(
  "report_export_audit_log",
  {
    id: serial("id").primaryKey(),
    reportKind: text("report_kind").notNull(),
    format: text("format").notNull(),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
    detailJson: jsonb("detail_json").$type<Record<string, unknown>>(),
    rowCount: integer("row_count"),
    fileBytes: integer("file_bytes").notNull(),
    downloadedByUserId: integer("downloaded_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    userRole: text("user_role").notNull(),
    userIp: text("user_ip"),
    userAgent: text("user_agent"),
    // When set, the accounting-failure digest email for this push has
    // already been delivered (or attempted). Used as an idempotency
    // guard so a retried push handler — or a buggy double-fire of
    // `maybeSendAccountingDigest` — does not email admins twice for
    // the same audit row. Always null on rows that never produced
    // warnings (digest is only sent when warnings are non-empty).
    accountingDigestEmailedAt: timestamp("accounting_digest_emailed_at", {
      withTimezone: true,
    }),
    // When set, the reconciliation-only digest email for this push has
    // already been delivered (or attempted). Same idempotency role as
    // `accountingDigestEmailedAt` but tracked separately so that a push
    // which warns first as reconciliation-only and is later retried in a
    // way that surfaces real failures still gets the failure digest
    // (and vice versa). Always null on rows that never produced
    // reconciliation drift.
    accountingReconciliationDigestEmailedAt: timestamp(
      "accounting_reconciliation_digest_emailed_at",
      { withTimezone: true },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxKind: index("report_export_audit_kind_idx").on(t.reportKind, t.createdAt),
    idxUser: index("report_export_audit_user_idx").on(
      t.downloadedByUserId,
      t.createdAt,
    ),
    idxCreatedAt: index("report_export_audit_created_idx").on(t.createdAt),
    // Expression index that backs the retry-chain BFS in
    // GET /reports/exports/audit. The endpoint walks the retry graph by
    // repeatedly looking up rows whose `scope->>'retriedFromAuditId'` casts
    // to a given parent id, and without an index that JSONB extract+cast
    // forces a sequential scan at every BFS depth (up to MAX_CHAIN_DEPTH=50
    // per request). The partial predicate matches the regex guard used in
    // the route so the index only carries rows that can ever satisfy the
    // query, keeping it small while still covering every legitimate retry.
    idxRetriedFromAuditId: index("report_export_audit_retried_from_idx").on(
      sql`((${t.scope}->>'retriedFromAuditId')::int)`,
    ).where(sql`${t.scope}->>'retriedFromAuditId' ~ '^[0-9]+$'`),
  }),
);

export const insertReportExportAuditLogSchema = createInsertSchema(
  reportExportAuditLogTable,
).omit({ id: true, createdAt: true });
export type InsertReportExportAuditLog = z.infer<
  typeof insertReportExportAuditLogSchema
>;
export type ReportExportAuditLog =
  typeof reportExportAuditLogTable.$inferSelect;
