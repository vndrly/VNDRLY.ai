// Scheduled "year-end 1099-K monthly breakout" email worker (Task #806).
//
// AP staff opt into this on the Reports page (Dashboard1099Card). The
// worker scans `dashboard_1099_email_settings` for `enabled = true`
// rows and emails the configured recipient list a PDF (and optionally
// CSV) of the same monthly breakout the dashboard's Download buttons
// produce — for the **prior tax year** by default, or the
// `taxYearOverride` if set.
//
// Cadence is intentionally hard-coded here, not in the settings table:
//
//   * Weekly in January — AP staff are actively assembling year-end
//     packets and want a fresh copy after every late-arriving payment
//     correction. Period label is the ISO week (e.g. "2026-W02").
//
//   * Monthly otherwise — one packet per calendar month is plenty
//     for ongoing record-keeping. Period label is "YYYY-MM".
//
// Idempotency: each (scope, partner_id, period) tuple is guarded by a
// UNIQUE `dedupe_key` in `dashboard_1099_email_log`. Every run inserts
// with ON CONFLICT DO NOTHING; the loser silently skips the email
// side effect. The scan fires every 6 hours so a missed run only
// costs ~6 hours of latency before the next attempt.
//
// Audit: each successful send writes one row per format to
// `report_export_audit_log` via the same `recordExport` path the
// download endpoints use. The scope JSON carries
// `{ sendKind: "scheduled_dashboard_email", recipients, partnerId,
// year, cadence }` so the existing audit endpoint surfaces them
// alongside the user-triggered downloads. The new
// `dashboard_1099_email_log` table cross-references those audit rows
// in `report_export_audit_ids_csv` for one-click drill-down.

import { eq, inArray } from "drizzle-orm";
import {
  db,
  dashboard1099EmailSettingsTable,
  dashboard1099EmailLogTable,
  partnersTable,
  reportExportAuditLogTable,
  type Dashboard1099EmailSettings,
} from "@workspace/db";
import { logger } from "./logger";
import { build1099Dashboard } from "./reports/dashboard1099";
import {
  dashboard1099MonthlyKCsv,
  dashboard1099MonthlyKPdf,
} from "./reports/dashboard1099-export";
import {
  sendDashboard1099MonthlyEmail,
  type Dashboard1099MonthlyEmailAttachment,
} from "./sendgrid";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface Dashboard1099MonthlyEmailResult {
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
}

export type ScheduleCadence = "weekly" | "monthly";

// Period label + cadence for the run "now" falls in. January gets
// weekly cadence (ISO week label); other months get monthly cadence
// ("YYYY-MM"). Both labels are stable and uniquely identify the
// dedupe window.
export function periodForRun(now: Date): {
  cadence: ScheduleCadence;
  label: string;
} {
  if (now.getUTCMonth() === 0) {
    return { cadence: "weekly", label: isoWeekLabel(now) };
  }
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return { cadence: "monthly", label: `${yyyy}-${mm}` };
}

// ISO-week label, e.g. "2026-W02". Same algorithm as ap-payment-digest.
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

// Default tax year is the prior calendar year — the natural "year-end
// packet" audience. The settings row may override with `taxYearOverride`.
export function defaultTaxYear(now: Date): number {
  return now.getUTCFullYear() - 1;
}

// Parse the comma-separated formats column. Filters to known values so
// a hand-edited row with garbage doesn't blow up the worker.
export function parseFormats(raw: string): Array<"pdf" | "csv"> {
  const out: Array<"pdf" | "csv"> = [];
  for (const tok of raw.split(",")) {
    const t = tok.trim().toLowerCase();
    if (t === "pdf" && !out.includes("pdf")) out.push("pdf");
    if (t === "csv" && !out.includes("csv")) out.push("csv");
  }
  return out;
}

// Parse the newline / comma / semicolon-separated recipient list. We
// accept any of those separators because the UI's textarea naturally
// produces newlines but copy/paste from a roster often uses commas.
export function parseRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw.split(/[\n,;]+/)) {
    const t = tok.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

interface RunArgs {
  /** Override "now" for tests. */
  now?: Date;
  /** Stub the SendGrid call for tests. Resolves to message id. */
  sendOverride?: typeof sendDashboard1099MonthlyEmail;
  /** Stub the dashboard build for tests. */
  buildDashboardOverride?: typeof build1099Dashboard;
}

export async function runDashboard1099MonthlyEmail(
  args: RunArgs = {},
): Promise<Dashboard1099MonthlyEmailResult> {
  const now = args.now ?? new Date();
  const send = args.sendOverride ?? sendDashboard1099MonthlyEmail;
  const buildDashboard =
    args.buildDashboardOverride ?? build1099Dashboard;
  const result: Dashboard1099MonthlyEmailResult = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
  };
  const { cadence, label: periodLabel } = periodForRun(now);

  const settingsRows: Dashboard1099EmailSettings[] = await db
    .select()
    .from(dashboard1099EmailSettingsTable)
    .where(eq(dashboard1099EmailSettingsTable.enabled, true));
  result.scanned = settingsRows.length;
  if (result.scanned === 0) return result;

  // Pre-load partner names so we don't fan out N queries inside the loop.
  const partnerIds = settingsRows
    .map((r) => r.partnerId)
    .filter((id): id is number => id != null);
  const partnerNameById = new Map<number, string>();
  if (partnerIds.length > 0) {
    const rows = await db
      .select({ id: partnersTable.id, name: partnersTable.name })
      .from(partnersTable)
      .where(inArray(partnersTable.id, partnerIds));
    for (const r of rows) partnerNameById.set(r.id, r.name);
  }

  for (const settings of settingsRows) {
    try {
      // Only one admin row exists; partner rows always have a partner_id.
      if (settings.scope !== "admin" && settings.scope !== "partner") {
        result.skipped += 1;
        continue;
      }
      if (settings.scope === "partner" && settings.partnerId == null) {
        result.skipped += 1;
        continue;
      }
      const formats = parseFormats(settings.formats);
      const recipients = parseRecipients(settings.recipientEmails);
      const taxYear = settings.taxYearOverride ?? defaultTaxYear(now);

      if (formats.length === 0 || recipients.length === 0) {
        result.skipped += 1;
        continue;
      }

      const scopeId =
        settings.scope === "admin" ? "admin" : String(settings.partnerId);
      const dedupeKey = `dashboard1099:${settings.scope}:${scopeId}:${periodLabel}`;

      // Claim the dedupe key first. Loser of the race silently skips
      // the email side effect.
      const claim = await db
        .insert(dashboard1099EmailLogTable)
        .values({
          scope: settings.scope,
          partnerId: settings.partnerId,
          taxYear,
          cadence,
          periodLabel,
          dedupeKey,
          recipientEmailsCsv: recipients.join(","),
          formatsCsv: formats.join(","),
        })
        .onConflictDoNothing({
          target: dashboard1099EmailLogTable.dedupeKey,
        })
        .returning({ id: dashboard1099EmailLogTable.id });
      if (claim.length === 0) {
        result.skipped += 1;
        continue;
      }
      const logRowId = claim[0]!.id;

      // Build the dashboard for this scope and filter to K rows.
      const payerPartnerId =
        settings.scope === "partner" ? settings.partnerId ?? undefined : undefined;
      const dashboard = await buildDashboard({
        year: taxYear,
        payerPartnerId,
      });
      const kRows = dashboard.rows.filter((r) => r.formType === "K");

      const partnerName = settings.partnerId
        ? partnerNameById.get(settings.partnerId)
        : undefined;
      const scopeLabel =
        settings.scope === "admin"
          ? "All payers (admin)"
          : `Payer: ${partnerName ?? `Partner ${settings.partnerId}`}`;

      const attachments: Dashboard1099MonthlyEmailAttachment[] = [];
      const auditRowIds: number[] = [];
      const baseFilename =
        settings.scope === "admin"
          ? `1099-k-monthly-admin-${taxYear}`
          : `1099-k-monthly-partner-${settings.partnerId}-${taxYear}`;
      const reportKind =
        settings.scope === "admin"
          ? "admin.1099kMonthly"
          : "partner.1099kMonthly";
      const auditScope: Record<string, unknown> = {
        sendKind: "scheduled_dashboard_email",
        cadence,
        periodLabel,
        recipients,
        year: taxYear,
        ...(settings.partnerId != null
          ? { partnerId: settings.partnerId }
          : {}),
      };

      if (formats.includes("csv")) {
        const csv = dashboard1099MonthlyKCsv(kRows);
        const buf = Buffer.from(csv, "utf-8");
        attachments.push({
          filename: `${baseFilename}.csv`,
          type: "text/csv",
          contentBase64: buf.toString("base64"),
        });
        const auditId = await insertAudit({
          reportKind,
          format: "1099_csv",
          scope: auditScope,
          rowCount: kRows.length,
          fileBytes: buf.byteLength,
        });
        if (auditId != null) auditRowIds.push(auditId);
      }
      if (formats.includes("pdf")) {
        const pdf = await dashboard1099MonthlyKPdf(taxYear, kRows, scopeLabel);
        attachments.push({
          filename: `${baseFilename}.pdf`,
          type: "application/pdf",
          contentBase64: pdf.toString("base64"),
        });
        const auditId = await insertAudit({
          reportKind,
          format: "1099_pdf",
          scope: auditScope,
          rowCount: kRows.length,
          fileBytes: pdf.byteLength,
        });
        if (auditId != null) auditRowIds.push(auditId);
      }

      try {
        await send({
          recipients,
          scope: settings.scope as "admin" | "partner",
          scopeLabel,
          partnerName,
          taxYear,
          cadence,
          attachments,
        });
        if (auditRowIds.length > 0) {
          await db
            .update(dashboard1099EmailLogTable)
            .set({ reportExportAuditIdsCsv: auditRowIds.join(",") })
            .where(eq(dashboard1099EmailLogTable.id, logRowId));
        }
        result.sent += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err, scope: settings.scope, partnerId: settings.partnerId },
          "Scheduled 1099-K monthly email failed",
        );
        await db
          .update(dashboard1099EmailLogTable)
          .set({ failureMessage: msg.slice(0, 240) })
          .where(eq(dashboard1099EmailLogTable.id, logRowId));
        result.errors += 1;
      }
    } catch (err) {
      logger.error(
        { err, settingsId: settings.id },
        "Scheduled 1099-K monthly email crashed for settings row",
      );
      result.errors += 1;
    }
  }
  return result;
}

async function insertAudit(args: {
  reportKind: string;
  format: "1099_csv" | "1099_pdf";
  scope: Record<string, unknown>;
  rowCount: number;
  fileBytes: number;
}): Promise<number | null> {
  try {
    const [row] = await db
      .insert(reportExportAuditLogTable)
      .values({
        reportKind: args.reportKind,
        format: args.format,
        scope: args.scope,
        rowCount: args.rowCount,
        fileBytes: args.fileBytes,
        downloadedByUserId: null,
        userRole: "system_scheduled",
        userIp: null,
        userAgent: "dashboard-1099-monthly-email-worker",
      })
      .returning({ id: reportExportAuditLogTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error(
      { err, format: args.format, reportKind: args.reportKind },
      "Failed to record scheduled 1099-K email audit row",
    );
    return null;
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startDashboard1099MonthlyEmailWorker(
  intervalMs = DEFAULT_INTERVAL_MS,
): void {
  if (intervalHandle) return;
  // Defer the first run so boot doesn't pile additional work onto the
  // already-busy listening event handler.
  setTimeout(() => void runOnce("startup"), 120 * 1000);
  intervalHandle = setInterval(() => {
    void runOnce("interval");
  }, intervalMs);
  logger.info(
    { intervalMs },
    "Dashboard 1099 monthly email worker started",
  );
}

export function stopDashboard1099MonthlyEmailWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function runOnce(trigger: "startup" | "interval"): Promise<void> {
  const start = Date.now();
  try {
    const r = await runDashboard1099MonthlyEmail();
    if (r.scanned > 0 || r.sent > 0 || r.errors > 0) {
      logger.info(
        { trigger, ms: Date.now() - start, ...r },
        "Dashboard 1099 monthly email scan complete",
      );
    }
  } catch (err) {
    logger.error(
      { err, trigger },
      "Dashboard 1099 monthly email scan crashed",
    );
  }
}

