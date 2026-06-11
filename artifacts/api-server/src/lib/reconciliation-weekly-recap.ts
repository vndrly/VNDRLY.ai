// Task #368 — Weekly reconciliation-drift recap worker.
//
// Vendors who have opted into reconciliation alerts can choose between
// two cadences on the Reports page:
//
//   * "per_push"     — one email immediately after every push that
//                      surfaces drift (legacy `maybeSendReconciliationDigest`
//                      path in `routes/reports.ts`).
//   * "weekly_recap" — this worker. The per-push email is suppressed
//                      and instead one summary email per week is sent
//                      to vendor admins covering the past 7 days of
//                      reconciliation drift.
//
// For every vendor with `accountingReconciliationNotificationsEnabled =
// true` AND `accountingReconciliationDigestCadence = "weekly_recap"` the
// worker:
//
//   1. Scans `report_export_audit_log` for push rows in the last 7 days
//      that recorded reconciliation warnings (skipping rows that the
//      reconciler filtered out as failures-only).
//   2. Aggregates per-day warning counts, per-bucket counts (perInvoice
//      / perState / fetchSkipped) and the worst-offending invoices.
//   3. Sends one email per vendor with a deep link back to the Reports
//      page filtered to the recap window.
//
// Idempotency: each (vendorId, ISO-week) tuple is guarded by a UNIQUE
// `dedupe_key` in `reconciliation_weekly_recap_log`. Every run inserts
// with ON CONFLICT DO NOTHING; the loser silently skips. The worker
// runs every 6 hours, so a missed run only costs ~6 hours of latency
// before the next attempt — and the dedupe key carries the ISO week
// label, so each vendor still receives at most one recap per week
// regardless of how often the scan fires.

import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  reportExportAuditLogTable,
  reconciliationWeeklyRecapLogTable,
  vendorsTable,
  userOrgMembershipsTable,
  usersTable,
} from "@workspace/db";
import {
  isReconciliationWarning,
  type PushWarning,
} from "@workspace/api-zod";
import { logger } from "./logger";
import { getAppOrigin } from "./appOrigin";
import {
  sendReconciliationWeeklyRecapEmail,
  type AccountingDigestRecipient,
  type EmailLocale,
  type ReconciliationWeeklyRecapPerDay,
  type ReconciliationWeeklyRecapWorstInvoice,
} from "./sendgrid";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const RECAP_WINDOW_DAYS = 7;
const MAX_WORST_INVOICES = 10;

// The audit log carries every push regardless of provider. We only
// consider rows whose reportKind is one of the API-push channels — the
// reconciler never runs against the file-export channels.
const PUSH_REPORT_KINDS = [
  "vendor.quickbooksPush",
  "vendor.openaccountantPush",
] as const;

export interface ReconciliationWeeklyRecapResult {
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
}

// ISO-week label, e.g. "2026-W18". Same algorithm as
// `ap-payment-digest.isoWeekLabel`. Used as the dedupe-key suffix so a
// vendor can receive at most one recap per ISO week regardless of how
// often the worker runs.
export function isoWeekLabel(d: Date): string {
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const week1 = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diffDays =
    (target.getTime() - week1.getTime()) / (24 * 60 * 60 * 1000);
  const week1Dow = (week1.getUTCDay() + 6) % 7;
  const weekNum = 1 + Math.round((diffDays - 3 + week1Dow) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// `YYYY-MM-DD` (UTC) for the per-day breakdown buckets.
function ymdUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Human-readable window label for the email body, e.g.
// "Apr 26 – May 03, 2026". Always rendered in en-US to keep the worker
// deterministic; the per-locale subject/body templates handle the
// surrounding sentence in either language.
function windowLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    });
  const yyyy = end.getUTCFullYear();
  return `${fmt(start)} – ${fmt(end)}, ${yyyy}`;
}

// Build the recap CTA deep link. The Reports page reads
// `?reconciliationRecap=1&start=YYYY-MM-DD&end=YYYY-MM-DD` and pre-
// applies both the audit log warnings filter and the date range.
export function buildReconciliationRecapUrl(
  start: Date,
  end: Date,
): string {
  const origin = getAppOrigin();
  // Param names match `parseAuditFiltersFromUrl` on the Reports page:
  // `from`/`to` (YYYY-MM-DD) seed the audit-log date range and
  // `onlyWarnings=1` pre-toggles the "show only syncs with warnings"
  // switch. `reconciliationRecap=1` is a marker the page can read for
  // future analytics — `parseAuditFiltersFromUrl` ignores unknown keys.
  const params = new URLSearchParams({
    reconciliationRecap: "1",
    onlyWarnings: "1",
    from: ymdUtc(start),
    to: ymdUtc(end),
  });
  return `${origin.replace(/\/+$/, "")}/reports?${params.toString()}`;
}

interface PushAuditRow {
  id: number;
  vendorId: number;
  createdAt: Date;
  warnings: PushWarning[];
}

// Pull warnings out of the audit row's `detailJson.warnings` array and
// coerce to the `PushWarning` shape, dropping anything that doesn't
// look like a reconciliation warning. Tolerant of legacy / malformed
// rows: anything that isn't a plain object with the right keys is
// silently skipped.
function extractReconciliationWarnings(detailJson: unknown): PushWarning[] {
  if (!detailJson || typeof detailJson !== "object") return [];
  const raw = (detailJson as { warnings?: unknown }).warnings;
  if (!Array.isArray(raw)) return [];
  const out: PushWarning[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    if (
      (o.kind === "customer" || o.kind === "vendor" || o.kind === "invoice") &&
      typeof o.identifier === "string" &&
      typeof o.message === "string"
    ) {
      const pw: PushWarning = {
        kind: o.kind,
        identifier: o.identifier,
        message: o.message,
      };
      if (isReconciliationWarning(pw)) out.push(pw);
    }
  }
  return out;
}

// Bucket reconciliation warnings the same way the per-push email does
// (mirrors `bucketReconciliationWarnings` in routes/reports.ts but
// duplicated here so the worker doesn't drag the route module in).
function bucketReconciliationWarnings(warnings: PushWarning[]): {
  perInvoice: number;
  perState: number;
  fetchSkipped: number;
} {
  const counts = { perInvoice: 0, perState: 0, fetchSkipped: 0 };
  for (const w of warnings) {
    if (w.identifier === "(reconciliation)") counts.fetchSkipped += 1;
    else if (w.identifier.startsWith("(state:")) counts.perState += 1;
    else counts.perInvoice += 1;
  }
  return counts;
}

// Build the per-day breakdown filling in zero-warning days inside the
// recap window so the email always renders a stable 7-row block.
function buildPerDay(
  start: Date,
  end: Date,
  rows: PushAuditRow[],
): ReconciliationWeeklyRecapPerDay[] {
  const counts = new Map<string, number>();
  // Seed every day in the window so a quiet day still shows up as
  // "0 drifted" in the email body.
  const cursor = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    ),
  );
  const stop = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );
  while (cursor.getTime() <= stop.getTime()) {
    counts.set(ymdUtc(cursor), 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const row of rows) {
    const key = ymdUtc(row.createdAt);
    counts.set(key, (counts.get(key) ?? 0) + row.warnings.length);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, warningCount]) => ({ date, warningCount }));
}

// Worst-offending invoices by warning count over the recap window.
// Filters out the `(reconciliation)` and `(state:XX)` synthetic
// identifiers — those aren't real invoices and surfacing them in this
// section would just confuse admins.
function buildWorstInvoices(
  rows: PushAuditRow[],
): ReconciliationWeeklyRecapWorstInvoice[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const w of row.warnings) {
      if (w.identifier === "(reconciliation)") continue;
      if (w.identifier.startsWith("(state:")) continue;
      counts.set(w.identifier, (counts.get(w.identifier) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_WORST_INVOICES)
    .map(([identifier, warningCount]) => ({ identifier, warningCount }));
}

// Local copy of `loadVendorAdminEmailRecipients` so the worker module
// doesn't drag the route module in. Joins user_org_memberships → users
// to find every admin for the vendor with a non-null email, dedup'd
// by email and tagged with each user's preferred locale.
async function loadVendorAdminRecipients(
  vendorId: number,
): Promise<AccountingDigestRecipient[]> {
  const rows = await db
    .select({
      email: usersTable.email,
      preferredLanguage: usersTable.preferredLanguage,
    })
    .from(userOrgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, userOrgMembershipsTable.userId))
    .where(
      and(
        eq(userOrgMembershipsTable.vendorId, vendorId),
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.role, "admin"),
        sql`${usersTable.email} is not null`,
      ),
    );
  const seen = new Set<string>();
  const out: AccountingDigestRecipient[] = [];
  for (const r of rows) {
    const e = (r.email ?? "").trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    const locale: EmailLocale = r.preferredLanguage === "es" ? "es" : "en";
    out.push({ email: e, locale });
  }
  return out;
}

interface RunArgs {
  /** Override "now" for tests. */
  now?: Date;
  /** Stub the SendGrid call for tests. */
  sendOverride?: typeof sendReconciliationWeeklyRecapEmail;
}

export async function runReconciliationWeeklyRecap(
  args: RunArgs = {},
): Promise<ReconciliationWeeklyRecapResult> {
  const now = args.now ?? new Date();
  const send = args.sendOverride ?? sendReconciliationWeeklyRecapEmail;
  const result: ReconciliationWeeklyRecapResult = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
  };
  const weekLabel = isoWeekLabel(now);
  const windowEnd = now;
  const windowStart = new Date(
    now.getTime() - RECAP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  // Step 1 — find every opted-in vendor on the weekly cadence.
  const vendors = await db
    .select({
      id: vendorsTable.id,
      name: vendorsTable.name,
    })
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.accountingReconciliationNotificationsEnabled, true),
        eq(
          vendorsTable.accountingReconciliationDigestCadence,
          "weekly_recap",
        ),
      ),
    );
  result.scanned = vendors.length;
  if (result.scanned === 0) return result;

  // Step 2 — pull every push audit row in the recap window. One query
  // for all opted-in vendors is cheaper than fanning out per vendor.
  const auditRows = await db
    .select({
      id: reportExportAuditLogTable.id,
      reportKind: reportExportAuditLogTable.reportKind,
      scope: reportExportAuditLogTable.scope,
      detailJson: reportExportAuditLogTable.detailJson,
      createdAt: reportExportAuditLogTable.createdAt,
    })
    .from(reportExportAuditLogTable)
    .where(
      and(
        gte(reportExportAuditLogTable.createdAt, windowStart),
        sql`${reportExportAuditLogTable.reportKind} = ANY(${PUSH_REPORT_KINDS as unknown as string[]})`,
      ),
    );

  // Group warnings by vendorId. We only consider rows that are pure
  // reconciliation drift (no per-row failure warnings present) — that
  // mirrors the per-push helper's gate so the recap stays focused on
  // the silent-drift case the failure digest never covers.
  const byVendor = new Map<number, PushAuditRow[]>();
  for (const row of auditRows) {
    const scope = (row.scope ?? {}) as { vendorId?: unknown };
    const vendorId =
      typeof scope.vendorId === "number" ? scope.vendorId : null;
    if (vendorId == null) continue;
    const allWarnings = (() => {
      const detail = row.detailJson as { warnings?: unknown } | null;
      const raw = Array.isArray(detail?.warnings) ? detail!.warnings : [];
      const out: PushWarning[] = [];
      for (const w of raw) {
        if (!w || typeof w !== "object") continue;
        const o = w as Record<string, unknown>;
        if (
          (o.kind === "customer" ||
            o.kind === "vendor" ||
            o.kind === "invoice") &&
          typeof o.identifier === "string" &&
          typeof o.message === "string"
        ) {
          out.push({
            kind: o.kind,
            identifier: o.identifier,
            message: o.message,
          });
        }
      }
      return out;
    })();
    const reconciliation = allWarnings.filter((w) =>
      isReconciliationWarning(w),
    );
    const failures = allWarnings.filter((w) => !isReconciliationWarning(w));
    // Same gate as the per-push helper: a row that mixes failures and
    // drift is owned by the failure digest and excluded from the recap.
    if (failures.length > 0) continue;
    if (reconciliation.length === 0) continue;
    const list = byVendor.get(vendorId) ?? [];
    list.push({
      id: row.id,
      vendorId,
      createdAt: row.createdAt,
      warnings: reconciliation,
    });
    byVendor.set(vendorId, list);
  }

  // Step 3 — for each opted-in vendor, claim the dedupe row, build
  // the aggregate, and send the recap email.
  for (const vendor of vendors) {
    const rows = byVendor.get(vendor.id) ?? [];
    if (rows.length === 0) {
      result.skipped += 1;
      continue;
    }
    const dedupeKey = `reconciliation_weekly_recap:${vendor.id}:${weekLabel}`;

    let logRowId: number | null = null;
    try {
      const claim = await db
        .insert(reconciliationWeeklyRecapLogTable)
        .values({
          vendorId: vendor.id,
          weekLabel,
          dedupeKey,
          sentAt: now,
          auditRowCount: rows.length,
          warningCount: rows.reduce((acc, r) => acc + r.warnings.length, 0),
        })
        .onConflictDoNothing({
          target: reconciliationWeeklyRecapLogTable.dedupeKey,
        })
        .returning({ id: reconciliationWeeklyRecapLogTable.id });
      if (claim.length === 0) {
        result.skipped += 1;
        continue;
      }
      logRowId = claim[0]!.id;

      const recipients = await loadVendorAdminRecipients(vendor.id);
      if (recipients.length === 0) {
        await db
          .update(reconciliationWeeklyRecapLogTable)
          .set({ failureMessage: "no_admin_recipients" })
          .where(eq(reconciliationWeeklyRecapLogTable.id, logRowId));
        result.skipped += 1;
        continue;
      }

      const allWarnings = rows.flatMap((r) => r.warnings);
      const counts = bucketReconciliationWarnings(allWarnings);
      const perDay = buildPerDay(windowStart, windowEnd, rows);
      const worstInvoices = buildWorstInvoices(rows);

      try {
        await send({
          recipients,
          vendorName: vendor.name,
          weekLabel,
          windowLabel: windowLabel(windowStart, windowEnd),
          recapUrl: buildReconciliationRecapUrl(windowStart, windowEnd),
          pushCount: rows.length,
          totalWarnings: allWarnings.length,
          perDay,
          countsByBucket: counts,
          worstInvoices,
        });
        result.sent += 1;
      } catch (sendErr) {
        const msg =
          sendErr instanceof Error ? sendErr.message : String(sendErr);
        logger.warn(
          { err: sendErr, vendorId: vendor.id },
          "Reconciliation weekly recap email failed",
        );
        await db
          .update(reconciliationWeeklyRecapLogTable)
          .set({ failureMessage: msg.slice(0, 240) })
          .where(eq(reconciliationWeeklyRecapLogTable.id, logRowId));
        result.errors += 1;
      }
    } catch (err) {
      logger.error(
        { err, vendorId: vendor.id },
        "Reconciliation weekly recap scan crashed for vendor",
      );
      result.errors += 1;
    }
  }
  return result;
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startReconciliationWeeklyRecapWorker(
  intervalMs = DEFAULT_INTERVAL_MS,
): void {
  if (intervalHandle) return;
  // Defer the first run so boot doesn't pile additional work onto the
  // already-busy listening event handler.
  setTimeout(() => void runOnce("startup"), 150 * 1000);
  intervalHandle = setInterval(() => {
    void runOnce("interval");
  }, intervalMs);
  logger.info(
    { intervalMs },
    "Reconciliation weekly recap worker started",
  );
}

export function stopReconciliationWeeklyRecapWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function runOnce(trigger: "startup" | "interval"): Promise<void> {
  const start = Date.now();
  try {
    const r = await runReconciliationWeeklyRecap();
    if (r.scanned > 0 || r.sent > 0 || r.errors > 0) {
      logger.info(
        { trigger, ms: Date.now() - start, ...r },
        "Reconciliation weekly recap scan complete",
      );
    }
  } catch (err) {
    logger.error(
      { err, trigger },
      "Reconciliation weekly recap scan crashed",
    );
  }
}

// Re-export for tests.
export { extractReconciliationWarnings };
