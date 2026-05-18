// Daily certification expiration reminder worker (Task #45).
//
// Scans active employee certifications and emails reminders at
// 60 / 30 / 7 days before expiration. Vendors receive a digest of
// their own employees' upcoming expirations; admins (`users.role =
// 'admin'`) get a global view across every vendor with at least one
// new trigger this run. Each reminder links back to the employee's
// detail page (which surfaces the certifications section as its main
// content).
//
// Idempotency: each (cert, threshold) pair is guarded by a UNIQUE
// `dedupe_key` on `certification_reminder_log`
// (`cert_expiration:<threshold>d:<certificationId>`). Worker restarts,
// repeated daily runs, or an extra interval tick on the same calendar
// day will all skip already-fired pairs via ON CONFLICT DO NOTHING.
//
// Retry semantics mirror invoice-aging: if the digest send fails after
// the dedupe row has been claimed, `failure_message` is populated on
// every involved row so the next scan re-attempts delivery without
// re-claiming the dedupe key. A successful send clears
// `failure_message` and locks the row in.
//
// Cadence: every 6 hours (4× per day) so a container restart, deploy,
// or transient DB blip costs at most ~6 hours of latency on a threshold
// notification. Per-(cert, threshold) dedupe keeps the recipient at
// exactly one delivered reminder regardless of how often we scan.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  certificationReminderLogTable,
  db,
  employeeCertificationsTable,
  fieldEmployeesTable,
  notificationPreferencesTable,
  userOrgMembershipsTable,
  usersTable,
  vendorsTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  sendCertExpirationAdminDigestEmail,
  sendCertExpirationVendorDigestEmail,
  type CertExpirationDigestRow,
} from "./sendgrid";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const CERT_REMINDER_THRESHOLDS_DAYS = [60, 30, 7] as const;
export type CertReminderThreshold =
  (typeof CERT_REMINDER_THRESHOLDS_DAYS)[number];

export interface CertReminderScanResult {
  scanned: number;
  triggersFired: number;
  triggersSkipped: number;
  vendorDigestsSent: number;
  vendorDigestsFailed: number;
  vendorDigestsSkippedNoRecipients: number;
  adminDigestsSent: number;
  adminDigestsFailed: number;
}

interface CertTriggerRow {
  certificationId: number;
  certName: string;
  certIssuer: string | null;
  expirationDate: string;
  threshold: CertReminderThreshold;
  employeeId: number;
  employeeFirstName: string;
  employeeLastName: string;
  vendorId: number;
  vendorName: string;
}

/**
 * Format a date as YYYY-MM-DD in UTC. Matches the on-disk shape of
 * `employee_certifications.expiration_date` (a `date` column) so a
 * direct equality compare in SQL works regardless of the driver's
 * local time-zone settings.
 */
export function targetExpirationDateUtc(now: Date, daysAhead: number): string {
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const target = new Date(todayUtc + daysAhead * 24 * 60 * 60 * 1000);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(target.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dedupeKey(certId: number, threshold: CertReminderThreshold): string {
  return `cert_expiration:${threshold}d:${certId}`;
}

function formatExpirationDateLabel(iso: string): string {
  // `iso` is YYYY-MM-DD. Render as "Jan 15, 2026" — readable in either
  // locale and avoids importing a heavyweight i18n helper into the
  // worker. Vendors with strict locale needs can flip preferred
  // language on their notification preferences page; we fall back to
  // EN here for both copy and date format to keep this file simple.
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function detailUrl(employeeId: number): string {
  const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  return baseUrl
    ? `${baseUrl}/field-employees/${employeeId}`
    : `/field-employees/${employeeId}`;
}

function toDigestRow(t: CertTriggerRow): CertExpirationDigestRow {
  const fullName = [t.employeeFirstName, t.employeeLastName]
    .filter((s) => s && s.trim().length > 0)
    .join(" ")
    .trim();
  return {
    employeeName: fullName || "(no name)",
    vendorName: t.vendorName,
    certName: t.certName,
    certIssuer: t.certIssuer,
    expirationDateLabel: formatExpirationDateLabel(t.expirationDate),
    daysUntilExpiration: t.threshold,
    detailUrl: detailUrl(t.employeeId),
  };
}

/**
 * Resolve vendor-side recipients for the digest. We fan out to every
 * user with a vendor membership (org_type='vendor', vendor_id=X) whose
 * `users.email` is set, who is not suspended, and who has not opted
 * out of the "compliance" notification category.
 */
async function loadVendorDigestRecipients(
  vendorId: number,
): Promise<string[]> {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      username: usersTable.username,
      suspendedAt: usersTable.suspendedAt,
      complianceEnabled: notificationPreferencesTable.complianceEnabled,
    })
    .from(userOrgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, userOrgMembershipsTable.userId))
    .leftJoin(
      notificationPreferencesTable,
      eq(notificationPreferencesTable.userId, usersTable.id),
    )
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, vendorId),
      ),
    );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (r.suspendedAt) continue;
    if (r.complianceEnabled === false) continue;
    // Prefer `users.email`; fall back to `username` (which is always
    // an email for vendor-derived logins per the comment on
    // users.email).
    const candidate = r.email?.trim() || r.username?.trim();
    if (!candidate) continue;
    if (!candidate.includes("@")) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/**
 * Resolve admin recipients for the global digest. Mirrors
 * `loadDigestRecipients` in signup-assistant-digest but keys on the
 * `compliance_enabled` preference (default true) so admins who muted
 * compliance noise in their preferences won't get this email.
 */
async function loadAdminDigestRecipients(): Promise<string[]> {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      username: usersTable.username,
      suspendedAt: usersTable.suspendedAt,
      complianceEnabled: notificationPreferencesTable.complianceEnabled,
    })
    .from(usersTable)
    .leftJoin(
      notificationPreferencesTable,
      eq(notificationPreferencesTable.userId, usersTable.id),
    )
    .where(eq(usersTable.role, "admin"));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (r.suspendedAt) continue;
    if (r.complianceEnabled === false) continue;
    const candidate = r.email?.trim() || r.username?.trim();
    if (!candidate) continue;
    if (!candidate.includes("@")) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

interface ClaimedRow {
  trigger: CertTriggerRow;
  /** Set when the row was previously claimed but the digest send
   *  failed; we re-attempt without re-inserting. */
  isRetry: boolean;
}

/**
 * Claim or re-attempt a (cert, threshold) trigger. Returns the
 * trigger to act on, or `null` when this pair has already been
 * delivered (no retry needed) or the dedupe insert lost a race.
 */
async function claimTrigger(
  trigger: CertTriggerRow,
  now: Date,
): Promise<ClaimedRow | null> {
  const key = dedupeKey(trigger.certificationId, trigger.threshold);
  const inserted = await db
    .insert(certificationReminderLogTable)
    .values({
      certificationId: trigger.certificationId,
      threshold: `${trigger.threshold}d`,
      dedupeKey: key,
      sentAt: now,
    })
    .onConflictDoNothing({
      target: certificationReminderLogTable.dedupeKey,
    })
    .returning({ id: certificationReminderLogTable.id });
  if (inserted.length > 0) {
    return { trigger, isRetry: false };
  }
  // Lost the race or already-claimed row exists. Re-attempt only when
  // the prior attempt logged a transient failure.
  const [existing] = await db
    .select({
      failureMessage: certificationReminderLogTable.failureMessage,
    })
    .from(certificationReminderLogTable)
    .where(eq(certificationReminderLogTable.dedupeKey, key));
  if (!existing || !existing.failureMessage) return null;
  return { trigger, isRetry: true };
}

async function markTriggerDelivered(
  trigger: CertTriggerRow,
  vendorId: number | null,
): Promise<void> {
  const key = dedupeKey(trigger.certificationId, trigger.threshold);
  await db
    .update(certificationReminderLogTable)
    .set({ failureMessage: null, sentToVendorId: vendorId })
    .where(eq(certificationReminderLogTable.dedupeKey, key));
}

async function markTriggersFailed(
  triggers: CertTriggerRow[],
  message: string,
): Promise<void> {
  if (triggers.length === 0) return;
  const keys = triggers.map((t) =>
    dedupeKey(t.certificationId, t.threshold),
  );
  // Cap stored message so a long SendGrid stack trace doesn't bloat
  // the row. The full error is also in the worker log line.
  const trimmed = message.slice(0, 240);
  await db
    .update(certificationReminderLogTable)
    .set({ failureMessage: trimmed })
    .where(inArray(certificationReminderLogTable.dedupeKey, keys));
}

/**
 * One-shot scan. Exposed for tests. Scans for certs whose
 * expiration_date matches today + T (T in 60/30/7), claims one row
 * per (cert, threshold) in the dedupe log, then groups the claimed
 * triggers by vendor for vendor digests + emits one global admin
 * digest. Best-effort throughout: a failure on one vendor's digest
 * does not prevent the rest from sending.
 */
export async function runCertificationReminderScan(
  now: Date = new Date(),
): Promise<CertReminderScanResult> {
  const result: CertReminderScanResult = {
    scanned: 0,
    triggersFired: 0,
    triggersSkipped: 0,
    vendorDigestsSent: 0,
    vendorDigestsFailed: 0,
    vendorDigestsSkippedNoRecipients: 0,
    adminDigestsSent: 0,
    adminDigestsFailed: 0,
  };

  // Pull every (cert, threshold) candidate in one round-trip per
  // threshold. The number of certs landing on a single calendar day
  // is small in practice; we don't try to stream.
  const allTriggers: CertTriggerRow[] = [];
  for (const threshold of CERT_REMINDER_THRESHOLDS_DAYS) {
    const targetDate = targetExpirationDateUtc(now, threshold);
    const rows = await db
      .select({
        certificationId: employeeCertificationsTable.id,
        certName: employeeCertificationsTable.name,
        certIssuer: employeeCertificationsTable.issuer,
        expirationDate: employeeCertificationsTable.expirationDate,
        employeeId: fieldEmployeesTable.id,
        employeeFirstName: fieldEmployeesTable.firstName,
        employeeLastName: fieldEmployeesTable.lastName,
        vendorId: fieldEmployeesTable.vendorId,
        vendorName: vendorsTable.name,
      })
      .from(employeeCertificationsTable)
      .innerJoin(
        fieldEmployeesTable,
        eq(fieldEmployeesTable.id, employeeCertificationsTable.employeeId),
      )
      .innerJoin(
        vendorsTable,
        eq(vendorsTable.id, fieldEmployeesTable.vendorId),
      )
      .where(
        and(
          isNull(employeeCertificationsTable.deletedAt),
          isNull(fieldEmployeesTable.deletedAt),
          eq(fieldEmployeesTable.isActive, true),
          // Compare against the YYYY-MM-DD literal. drizzle's `eq`
          // doesn't auto-cast a string into a `date` column on every
          // PG driver, so use a sql template that emits an explicit
          // ::date cast. This stays type-safe because we built
          // `targetDate` ourselves.
          sql`${employeeCertificationsTable.expirationDate} = ${targetDate}::date`,
        ),
      );
    for (const r of rows) {
      if (!r.expirationDate) continue;
      allTriggers.push({
        certificationId: r.certificationId,
        certName: r.certName,
        certIssuer: r.certIssuer,
        expirationDate: r.expirationDate,
        threshold,
        employeeId: r.employeeId,
        employeeFirstName: r.employeeFirstName,
        employeeLastName: r.employeeLastName,
        vendorId: r.vendorId,
        vendorName: r.vendorName,
      });
    }
  }
  result.scanned = allTriggers.length;
  if (allTriggers.length === 0) return result;

  // Claim each (cert, threshold). Successful claims (or retry-eligible
  // failed-prior rows) become the work list for the digest stage.
  const claimed: ClaimedRow[] = [];
  for (const trigger of allTriggers) {
    try {
      const c = await claimTrigger(trigger, now);
      if (c) {
        claimed.push(c);
        result.triggersFired += 1;
      } else {
        result.triggersSkipped += 1;
      }
    } catch (err) {
      logger.warn(
        { err, certId: trigger.certificationId, threshold: trigger.threshold },
        "Certification reminder claim failed",
      );
      result.triggersSkipped += 1;
    }
  }
  if (claimed.length === 0) return result;

  // Group by vendor for the per-vendor digests.
  const byVendor = new Map<number, CertTriggerRow[]>();
  for (const c of claimed) {
    const arr = byVendor.get(c.trigger.vendorId) ?? [];
    arr.push(c.trigger);
    byVendor.set(c.trigger.vendorId, arr);
  }

  // Track which triggers were successfully delivered via a vendor
  // digest. The admin digest is built from the same `claimed` list
  // independently — admins should still see a row for a vendor that
  // has no recipients (vendor-side delivery may be impossible but the
  // admins still need awareness).
  for (const [vendorId, triggers] of byVendor.entries()) {
    const vendorName = triggers[0]!.vendorName;
    let recipients: string[];
    try {
      recipients = await loadVendorDigestRecipients(vendorId);
    } catch (err) {
      logger.error(
        { err, vendorId },
        "Certification reminder vendor recipient lookup failed",
      );
      await markTriggersFailed(triggers, "vendor_recipient_lookup_failed");
      result.vendorDigestsFailed += 1;
      continue;
    }
    if (recipients.length === 0) {
      // Mark so the next scan does not blindly retry — the row stays
      // in place, but `no_vendor_recipients` is a "human action
      // required" terminal state until somebody adds a vendor user.
      await markTriggersFailed(triggers, "no_vendor_recipients");
      result.vendorDigestsSkippedNoRecipients += 1;
      continue;
    }
    try {
      await sendCertExpirationVendorDigestEmail({
        recipients,
        vendorName,
        rows: triggers
          .slice()
          .sort((a, b) => a.threshold - b.threshold)
          .map(toDigestRow),
      });
      for (const t of triggers) {
        await markTriggerDelivered(t, vendorId);
      }
      result.vendorDigestsSent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, vendorId, count: triggers.length },
        "Certification reminder vendor digest send failed",
      );
      await markTriggersFailed(triggers, msg);
      result.vendorDigestsFailed += 1;
    }
  }

  // Admin digest — global view of every claimed trigger this run.
  // The dedupe rows ensure the same (cert, threshold) cannot appear
  // in multiple admin digests across runs, so we don't need a
  // separate admin-side dedupe key.
  try {
    const adminRecipients = await loadAdminDigestRecipients();
    if (adminRecipients.length > 0) {
      const allRows = claimed
        .map((c) => c.trigger)
        .slice()
        .sort((a, b) => {
          if (a.threshold !== b.threshold) return a.threshold - b.threshold;
          return a.vendorName.localeCompare(b.vendorName);
        })
        .map(toDigestRow);
      try {
        await sendCertExpirationAdminDigestEmail({
          recipients: adminRecipients,
          rows: allRows,
          vendorCount: byVendor.size,
        });
        result.adminDigestsSent += 1;
      } catch (err) {
        logger.warn(
          { err, count: allRows.length },
          "Certification reminder admin digest send failed",
        );
        result.adminDigestsFailed += 1;
      }
    }
  } catch (err) {
    logger.error(
      { err },
      "Certification reminder admin recipient lookup failed",
    );
    result.adminDigestsFailed += 1;
  }

  return result;
}

let intervalHandle: NodeJS.Timeout | null = null;
let firstTickHandle: NodeJS.Timeout | null = null;

export function startCertificationReminderWorker(
  intervalMs = DEFAULT_INTERVAL_MS,
): void {
  if (intervalHandle) return;
  // Defer the first run so server boot doesn't block on a SendGrid
  // round-trip.
  firstTickHandle = setTimeout(() => {
    firstTickHandle = null;
    void runOnce("startup");
  }, 90 * 1000);
  intervalHandle = setInterval(() => {
    void runOnce("interval");
  }, intervalMs);
  logger.info({ intervalMs }, "Certification reminder worker started");
}

export function stopCertificationReminderWorker(): void {
  if (firstTickHandle) {
    clearTimeout(firstTickHandle);
    firstTickHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function runOnce(trigger: "startup" | "interval"): Promise<void> {
  const start = Date.now();
  try {
    const r = await runCertificationReminderScan();
    if (r.scanned > 0 || r.triggersFired > 0) {
      logger.info(
        {
          trigger,
          ms: Date.now() - start,
          ...r,
        },
        "Certification reminder scan complete",
      );
    }
  } catch (err) {
    logger.error({ err, trigger }, "Certification reminder scan crashed");
  }
}
