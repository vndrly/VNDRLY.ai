// Audit recorder for Phase 4 report exports. One row per externally-shareable
// download (CSV / PDF / IIF / zip / 1099). On-screen JSON previews are NOT
// audited — see report_export_audit_log schema comment.

import type { Request } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  reportExportAuditLogTable,
  usersTable,
  type ReportExportFormat,
} from "@workspace/db";
import { getSessionFromRequest as getSession } from "../session";
import { logger } from "../logger";

export interface RecordExportInput {
  req: Request;
  reportKind: string;
  format: ReportExportFormat;
  scope: Record<string, unknown>;
  rowCount?: number | null;
  fileBytes: number;
  /** Optional after-the-fact details (e.g. push warnings). Stored in
   *  `detail_json`; the audit endpoint returns this so admins can drill
   *  into a sync's failed rows and retry just those. */
  detailJson?: Record<string, unknown> | null;
}

/** Returns the inserted audit row id, or null if the insert was swallowed
 *  (audit must never block the caller). Push routes use the id so the
 *  client can request "retry from this audit row". */
export async function recordExport(
  input: RecordExportInput,
): Promise<number | null> {
  try {
    const session = getSession(input.req);
    const userId = session?.userId ?? null;
    const role = session?.role ?? "anonymous";
    // Express trust-proxy is not configured in dev; fall back to socket addr.
    const ip =
      (input.req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim() ||
      input.req.socket.remoteAddress ||
      null;
    const ua = (input.req.headers["user-agent"] as string | undefined) ?? null;

    const [row] = await db
      .insert(reportExportAuditLogTable)
      .values({
        reportKind: input.reportKind,
        format: input.format,
        scope: input.scope,
        detailJson: input.detailJson ?? null,
        rowCount: input.rowCount ?? null,
        fileBytes: input.fileBytes,
        downloadedByUserId: userId,
        userRole: role,
        userIp: ip,
        userAgent: ua,
      })
      .returning({ id: reportExportAuditLogTable.id });
    return row?.id ?? null;
  } catch (err) {
    // Audit failure must NOT block the download — log and move on.
    logger.error(
      { err, reportKind: input.reportKind, format: input.format },
      "Failed to record report export audit row",
    );
    return null;
  }
}

/** One re-sync history entry surfaced on the invoice detail page. */
export interface InvoiceResyncHistoryEntry {
  id: number;
  provider: "qbo" | "oa";
  /** ISO timestamp when the re-sync was attempted. */
  at: string;
  /** "updated" → succeeded; "missing" → remote invoice was deleted in
   *  QuickBooks/OpenAccountant. Mirrors the `outcome` written by the
   *  push routes into `scope`. */
  outcome: "updated" | "missing" | "unknown";
  /** Free-form display name for the user who triggered the re-sync.
   *  Falls back to username if `displayName` is empty, and finally to
   *  null when the user record was hard-deleted (set null on FK). */
  byUserId: number | null;
  byUserDisplayName: string | null;
  byUserUsername: string | null;
  /** Captured at the time of the re-sync. Useful for the "Updated" row
   *  so admins can confirm the re-sync hit the same accounting record
   *  the card currently shows. Null when the row failed before we got
   *  a remote id back (e.g. missing). */
  externalDocNumber: string | null;
  /** When the re-sync surfaced a warning (e.g. partial failure on
   *  individual lines), expose the count so the UI can render a small
   *  "1 warning" badge without us shipping the whole detail blob. */
  warningCount: number;
  /** When `outcome === "missing"`, the human-readable error message
   *  the QBO/OA client returned. Null otherwise. */
  errorMessage: string | null;
}

/** Optional opts for {@link loadInvoiceResyncHistory}. `beforeId` lets
 *  the paginated /invoices/:id/resync-history endpoint walk older
 *  pages by passing the smallest id from the previous response. The
 *  query orders by `desc(id)` (see below), so "older" === strictly
 *  `id < beforeId` and the cursor can never skip or duplicate a row
 *  across page boundaries even when two re-syncs land in the same
 *  millisecond.
 */
export interface LoadInvoiceResyncHistoryOpts {
  limit?: number;
  beforeId?: number;
}

/** Pull the most recent per-invoice re-sync events for the given
 *  invoice. Filters `report_export_audit_log` to the two re-sync
 *  formats and matches `scope.invoiceId` against the invoice id we
 *  just fetched. Joined to `users` so the UI can render a friendly
 *  name without a second round-trip.
 *
 *  Returns an empty array on failure — the invoice detail endpoint
 *  must keep working even if the audit table is unavailable. */
export async function loadInvoiceResyncHistory(
  invoiceId: number,
  optsOrLimit: number | LoadInvoiceResyncHistoryOpts = 10,
): Promise<InvoiceResyncHistoryEntry[]> {
  const opts: LoadInvoiceResyncHistoryOpts =
    typeof optsOrLimit === "number" ? { limit: optsOrLimit } : optsOrLimit;
  const limit = opts.limit ?? 10;
  const beforeId = opts.beforeId;
  try {
    const conds = [
      inArray(reportExportAuditLogTable.format, [
        "qbo_api_resync",
        "oa_api_resync",
      ]),
      // jsonb scope is opaque, so reach into it with the ->> operator
      // and cast to int for the equality check. Using `${invoiceId}`
      // (a JS number) is safe because drizzle parameterises it.
      sql`(${reportExportAuditLogTable.scope}->>'invoiceId')::int = ${invoiceId}`,
    ];
    if (typeof beforeId === "number" && Number.isFinite(beforeId)) {
      // Cursor predicate must align with the ORDER BY below. We sort
      // by `desc(id)` precisely so this `id < beforeId` filter walks
      // strictly older rows with no skips or duplicates across page
      // boundaries — even when two re-syncs share a millisecond on
      // createdAt (which would make a createdAt-only sort
      // non-deterministic).
      conds.push(sql`${reportExportAuditLogTable.id} < ${beforeId}`);
    }
    const rows = await db
      .select({
        id: reportExportAuditLogTable.id,
        format: reportExportAuditLogTable.format,
        scope: reportExportAuditLogTable.scope,
        detailJson: reportExportAuditLogTable.detailJson,
        createdAt: reportExportAuditLogTable.createdAt,
        userId: reportExportAuditLogTable.downloadedByUserId,
        userDisplayName: usersTable.displayName,
        userUsername: usersTable.username,
      })
      .from(reportExportAuditLogTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, reportExportAuditLogTable.downloadedByUserId),
      )
      .where(and(...conds))
      // Sort by `desc(id)` (not desc(createdAt)) so the ordering is
      // strictly deterministic and aligned with the `id < beforeId`
      // cursor predicate above. Audit ids are auto-increment and
      // re-sync rows are append-only, so within the per-invoice slice
      // higher id === newer event — this matches the user-facing
      // "newest first" expectation while keeping pagination correct.
      .orderBy(desc(reportExportAuditLogTable.id))
      .limit(limit);

    return rows.map((r) => {
      const scope = (r.scope ?? {}) as Record<string, unknown>;
      const detail = (r.detailJson ?? {}) as Record<string, unknown>;
      const outcomeRaw = scope.outcome;
      const outcome: InvoiceResyncHistoryEntry["outcome"] =
        outcomeRaw === "updated" || outcomeRaw === "missing"
          ? outcomeRaw
          : "unknown";
      const warnings = Array.isArray(detail.warnings) ? detail.warnings : [];
      const errorMessage =
        outcome === "missing" && typeof detail.message === "string"
          ? (detail.message as string)
          : null;
      const externalDocNumber =
        typeof scope.externalDocNumber === "string"
          ? (scope.externalDocNumber as string)
          : null;
      return {
        id: r.id,
        provider: r.format === "qbo_api_resync" ? "qbo" : "oa",
        at: (r.createdAt as Date).toISOString(),
        outcome,
        byUserId: r.userId ?? null,
        byUserDisplayName: r.userDisplayName ?? null,
        byUserUsername: r.userUsername ?? null,
        externalDocNumber,
        warningCount: warnings.length,
        errorMessage,
      };
    });
  } catch (err) {
    logger.error(
      { err, invoiceId },
      "Failed to load invoice re-sync audit history",
    );
    return [];
  }
}
