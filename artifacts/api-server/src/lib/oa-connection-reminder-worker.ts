// Daily OpenAccountant connection reminder worker (Task #248).
//
// Scans `accounting_connections` rows where provider='oa' and either:
//   • status = 'revoked'   — the most recent token refresh failed and
//                            `markRevoked()` flipped the row. Vendors
//                            don't otherwise see this until they try
//                            to push and watch the request blow up at
//                            month-end.
//   • status = 'active' but the access token is approaching expiry
//                            (within EXPIRING_SOON_WINDOW_DAYS) AND
//                            no recent refresh has bumped `updated_at`
//                            (older than STALE_REFRESH_DAYS). The
//                            two-condition gate distinguishes a
//                            healthy connection (refreshed every push,
//                            short-lived access token) from a dormant
//                            one whose refresh token is likely about
//                            to expire silently.
//
// For each match the worker emails the user who created the connection
// (when an email is on file), fans the in-app notification out to every
// vendor admin via `notifyUsers`, and stamps a dedupe row in
// `accounting_connection_reminder_log` so repeat scans don't re-spam.
//
// Idempotency: each (connection, occurrence) is guarded by a UNIQUE
// `dedupe_key`:
//   • revoked       — `oa_conn_revoked:<connectionId>:<updatedAtMs>`
//                     so a re-revoked connection (after a successful
//                     reconnect that bumps updated_at) gets a fresh
//                     reminder.
//   • expiring_soon — `oa_conn_expiring_soon:<connectionId>:<YYYY-MM>`
//                     so a long-stale connection re-pings monthly
//                     instead of once-and-forever.
//
// Cadence: every 6 hours (4× per day) so a container restart, deploy,
// or transient DB blip costs at most ~6 hours of latency. The dedupe
// log keeps the recipient at exactly one delivered reminder per
// (connection, occurrence).

import { and, eq, isNotNull, lt, lte, or } from "drizzle-orm";
import {
  accountingConnectionReminderLogTable,
  accountingConnectionsTable,
  db,
  userOrgMembershipsTable,
  usersTable,
  vendorsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendOaConnectionReminderEmail } from "./sendgrid";
import { notifyUsers } from "../routes/notifications";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// "Approaching expiration" lookahead. A connection whose access token
// expires within this window AND hasn't been refreshed lately gets
// the proactive nudge — the vendor still has time to reconnect before
// the next push falls over. 7 days is long enough to span a weekend
// + a holiday so the email doesn't land too late to act on.
const EXPIRING_SOON_WINDOW_DAYS = 7;
// "No recent refresh" gate that pairs with EXPIRING_SOON_WINDOW_DAYS.
// A healthy active connection is refreshed on every push, which bumps
// `updated_at`. If `updated_at` is older than this threshold AND the
// access token is approaching expiry, the connection is effectively
// dormant and likely won't auto-refresh in time. 7 days matches the
// weekly billing cadence most vendors run on.
const STALE_REFRESH_DAYS = 7;

export type OaReminderReason = "revoked" | "expiring_soon";

export interface OaReminderScanResult {
  scanned: number;
  triggersFired: number;
  triggersSkipped: number;
  emailSent: number;
  emailFailed: number;
  inAppRecipients: number;
}

interface CandidateRow {
  connectionId: number;
  vendorId: number;
  vendorName: string;
  displayName: string | null;
  status: "active" | "expired" | "revoked";
  accessTokenExpiresAt: Date | null;
  updatedAt: Date;
  createdByUserId: number | null;
  reason: OaReminderReason;
  // Stable dedupe occurrence marker (e.g. updatedAt epoch ms or YYYY-MM).
  occurrenceKey: string;
}

function dedupeKey(reason: OaReminderReason, row: CandidateRow): string {
  return `oa_conn_${reason}:${row.connectionId}:${row.occurrenceKey}`;
}

function yyyyMmUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function buildLink(vendorId: number): string {
  const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  const path = `/reports?vendorId=${vendorId}`;
  return baseUrl ? `${baseUrl}${path}` : path;
}

function connectionLabel(row: CandidateRow): string {
  return row.displayName?.trim() || `OpenAccountant connection #${row.connectionId}`;
}

interface NotifCopy {
  type: string;
  title: string;
  body: string;
}

function copyFor(row: CandidateRow): NotifCopy {
  const label = connectionLabel(row);
  if (row.reason === "revoked") {
    return {
      type: "oa_connection_revoked",
      title: `OpenAccountant connection revoked for ${row.vendorName}`,
      body:
        `${label} can no longer reach OpenAccountant. ` +
        `Reconnect on the Reports page so syncs resume before your next push.`,
    };
  }
  return {
    type: "oa_connection_expiring",
    title: `OpenAccountant connection expiring soon for ${row.vendorName}`,
    body:
      `${label} hasn't been refreshed in over ${STALE_REFRESH_DAYS} days ` +
      `and its access token expires within ${EXPIRING_SOON_WINDOW_DAYS} days. ` +
      `Reconnect to verify it still works before your next push.`,
  };
}

/**
 * Resolve the union of (a) the user who created the connection and
 * (b) every active vendor user — these are the in-app notification
 * recipients. Suspended users are excluded.
 */
async function resolveRecipientUserIds(
  vendorId: number,
  createdByUserId: number | null,
): Promise<number[]> {
  const rows = await db
    .select({
      id: usersTable.id,
      suspendedAt: usersTable.suspendedAt,
    })
    .from(userOrgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, userOrgMembershipsTable.userId))
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, vendorId),
      ),
    );
  const out = new Set<number>();
  for (const r of rows) {
    if (r.suspendedAt) continue;
    out.add(r.id);
  }
  if (createdByUserId != null) {
    // The creator may no longer be a vendor member (role change /
    // moved orgs) but we still owe them the alert because their token
    // is the one stored.
    const [creator] = await db
      .select({ suspendedAt: usersTable.suspendedAt })
      .from(usersTable)
      .where(eq(usersTable.id, createdByUserId));
    if (creator && !creator.suspendedAt) out.add(createdByUserId);
  }
  return [...out];
}

interface CreatorContact {
  email: string;
  name: string | null;
}

async function resolveCreatorContact(
  createdByUserId: number | null,
): Promise<CreatorContact | null> {
  if (createdByUserId == null) return null;
  const [u] = await db
    .select({
      email: usersTable.email,
      username: usersTable.username,
      displayName: usersTable.displayName,
      suspendedAt: usersTable.suspendedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, createdByUserId));
  if (!u || u.suspendedAt) return null;
  const candidate = u.email?.trim() || u.username?.trim() || "";
  if (!candidate.includes("@")) return null;
  return { email: candidate, name: u.displayName ?? null };
}

/**
 * Claim a (connection, occurrence) reminder slot. Returns true on
 * fresh insert (this scan should send the reminder) or when a prior
 * row claimed the slot but failed delivery (retry). Returns false
 * when the slot was already delivered successfully.
 */
async function claimReminder(
  row: CandidateRow,
): Promise<{ claimed: boolean; isRetry: boolean }> {
  const key = dedupeKey(row.reason, row);
  const inserted = await db
    .insert(accountingConnectionReminderLogTable)
    .values({
      connectionId: row.connectionId,
      reason: row.reason,
      dedupeKey: key,
    })
    .onConflictDoNothing({
      target: accountingConnectionReminderLogTable.dedupeKey,
    })
    .returning({ id: accountingConnectionReminderLogTable.id });
  if (inserted.length > 0) return { claimed: true, isRetry: false };
  const [existing] = await db
    .select({
      failureMessage: accountingConnectionReminderLogTable.failureMessage,
    })
    .from(accountingConnectionReminderLogTable)
    .where(eq(accountingConnectionReminderLogTable.dedupeKey, key));
  if (existing && existing.failureMessage) {
    return { claimed: true, isRetry: true };
  }
  return { claimed: false, isRetry: false };
}

async function markReminderDelivered(
  row: CandidateRow,
  recipientCount: number,
): Promise<void> {
  const key = dedupeKey(row.reason, row);
  await db
    .update(accountingConnectionReminderLogTable)
    .set({ failureMessage: null, recipientCount })
    .where(eq(accountingConnectionReminderLogTable.dedupeKey, key));
}

async function markReminderFailed(
  row: CandidateRow,
  message: string,
): Promise<void> {
  const key = dedupeKey(row.reason, row);
  const trimmed = message.slice(0, 240);
  await db
    .update(accountingConnectionReminderLogTable)
    .set({ failureMessage: trimmed })
    .where(eq(accountingConnectionReminderLogTable.dedupeKey, key));
}

/**
 * One-shot scan. Exposed for tests.
 */
export async function runOaConnectionReminderScan(
  now: Date = new Date(),
): Promise<OaReminderScanResult> {
  const result: OaReminderScanResult = {
    scanned: 0,
    triggersFired: 0,
    triggersSkipped: 0,
    emailSent: 0,
    emailFailed: 0,
    inAppRecipients: 0,
  };

  const expiringHorizon = new Date(
    now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const staleRefreshCutoff = new Date(
    now.getTime() - STALE_REFRESH_DAYS * 24 * 60 * 60 * 1000,
  );

  const rows = await db
    .select({
      connectionId: accountingConnectionsTable.id,
      vendorId: accountingConnectionsTable.vendorId,
      vendorName: vendorsTable.name,
      displayName: accountingConnectionsTable.displayName,
      status: accountingConnectionsTable.status,
      accessTokenExpiresAt: accountingConnectionsTable.accessTokenExpiresAt,
      updatedAt: accountingConnectionsTable.updatedAt,
      createdByUserId: accountingConnectionsTable.createdByUserId,
    })
    .from(accountingConnectionsTable)
    .innerJoin(
      vendorsTable,
      eq(vendorsTable.id, accountingConnectionsTable.vendorId),
    )
    .where(
      and(
        eq(accountingConnectionsTable.provider, "oa"),
        or(
          eq(accountingConnectionsTable.status, "revoked"),
          and(
            eq(accountingConnectionsTable.status, "active"),
            isNotNull(accountingConnectionsTable.accessTokenExpiresAt),
            // Token approaching expiry — fires BEFORE the access
            // token actually expires, leaving the user time to act.
            lte(
              accountingConnectionsTable.accessTokenExpiresAt,
              expiringHorizon,
            ),
            // Paired "no recent refresh" gate: a healthy connection
            // would have been refreshed within the last few days, so
            // this filters out tokens that are about to be auto-
            // refreshed by the next push.
            lt(accountingConnectionsTable.updatedAt, staleRefreshCutoff),
          ),
        ),
      ),
    );

  const candidates: CandidateRow[] = [];
  for (const r of rows) {
    const reason: OaReminderReason =
      r.status === "revoked" ? "revoked" : "expiring_soon";
    const occurrenceKey =
      reason === "revoked"
        ? String(new Date(r.updatedAt).getTime())
        : yyyyMmUtc(now);
    candidates.push({
      connectionId: r.connectionId,
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      displayName: r.displayName,
      status: r.status as "active" | "expired" | "revoked",
      accessTokenExpiresAt: r.accessTokenExpiresAt
        ? new Date(r.accessTokenExpiresAt)
        : null,
      updatedAt: new Date(r.updatedAt),
      createdByUserId: r.createdByUserId,
      reason,
      occurrenceKey,
    });
  }
  result.scanned = candidates.length;

  for (const row of candidates) {
    let claim: { claimed: boolean; isRetry: boolean };
    try {
      claim = await claimReminder(row);
    } catch (err) {
      logger.warn(
        { err, connectionId: row.connectionId, reason: row.reason },
        "OA connection reminder claim failed",
      );
      result.triggersSkipped += 1;
      continue;
    }
    if (!claim.claimed) {
      result.triggersSkipped += 1;
      continue;
    }
    result.triggersFired += 1;

    const copy = copyFor(row);
    const link = buildLink(row.vendorId);

    // In-app fan-out — every vendor user + the creator (deduped). The
    // dedupeKey on the notification row guarantees a single bell entry
    // per (user, occurrence) even across worker restarts.
    let recipients: number[] = [];
    try {
      recipients = await resolveRecipientUserIds(row.vendorId, row.createdByUserId);
    } catch (err) {
      logger.warn(
        { err, connectionId: row.connectionId },
        "OA connection reminder recipient lookup failed",
      );
    }
    let inAppCount = 0;
    if (recipients.length > 0) {
      try {
        inAppCount = await notifyUsers(recipients, {
          type: copy.type,
          title: copy.title,
          body: copy.body,
          link,
          dedupeKey: dedupeKey(row.reason, row),
        });
        result.inAppRecipients += inAppCount;
      } catch (err) {
        logger.warn(
          { err, connectionId: row.connectionId },
          "OA connection reminder in-app fan-out failed",
        );
      }
    }

    // Direct email to the creator. We send this independently of the
    // per-category email opt-in because a broken accounting connection
    // is operational information the creator owns by default — they
    // can mute via the in-app preference and unsubscribe via SendGrid
    // headers if they want to silence the email channel separately.
    let emailedTo: CreatorContact | null = null;
    try {
      emailedTo = await resolveCreatorContact(row.createdByUserId);
    } catch (err) {
      logger.warn(
        { err, connectionId: row.connectionId },
        "OA connection reminder creator lookup failed",
      );
    }
    let emailOk = true;
    if (emailedTo) {
      try {
        await sendOaConnectionReminderEmail({
          to: emailedTo.email,
          recipientName: emailedTo.name,
          vendorName: row.vendorName,
          connectionLabel: connectionLabel(row),
          reason: row.reason,
          expiringSoonWindowDays: EXPIRING_SOON_WINDOW_DAYS,
          staleRefreshDays: STALE_REFRESH_DAYS,
          reportsUrl: link,
        });
        result.emailSent += 1;
      } catch (err) {
        emailOk = false;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err, connectionId: row.connectionId, reason: row.reason },
          "OA connection reminder email failed",
        );
        await markReminderFailed(row, msg);
        result.emailFailed += 1;
      }
    }

    if (emailOk) {
      try {
        await markReminderDelivered(row, inAppCount + (emailedTo ? 1 : 0));
      } catch (err) {
        logger.warn(
          { err, connectionId: row.connectionId },
          "OA connection reminder mark-delivered failed",
        );
      }
    }
  }

  return result;
}

let intervalHandle: NodeJS.Timeout | null = null;
let firstTickHandle: NodeJS.Timeout | null = null;

export function startOaConnectionReminderWorker(
  intervalMs = DEFAULT_INTERVAL_MS,
): void {
  if (intervalHandle) return;
  // Defer the first run so server boot doesn't block on a SendGrid
  // round-trip. Stagger past the cert worker's 90s delay to avoid
  // hammering the connectors hostname at the same moment.
  firstTickHandle = setTimeout(() => {
    firstTickHandle = null;
    void runOnce("startup");
  }, 120 * 1000);
  intervalHandle = setInterval(() => {
    void runOnce("interval");
  }, intervalMs);
  logger.info({ intervalMs }, "OA connection reminder worker started");
}

export function stopOaConnectionReminderWorker(): void {
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
    const r = await runOaConnectionReminderScan();
    if (r.scanned > 0 || r.triggersFired > 0) {
      logger.info(
        { trigger, ms: Date.now() - start, ...r },
        "OA connection reminder scan complete",
      );
    }
  } catch (err) {
    logger.error({ err, trigger }, "OA connection reminder scan crashed");
  }
}

