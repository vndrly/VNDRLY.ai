// Signup-assistant abuse-summary email worker.
//
// Why this exists: the public signup-page assistant
// (`POST /assistant/signup/:persona/chat`) is unauthenticated. We
// already enforce a per-IP fixed-window limiter and a global per-day
// circuit breaker (`signup-assistant-rate-limit.ts`) so a script
// can't burn unbounded Anthropic credits, but those gates are
// silent: the only way an admin currently learns that a script
// drained 75% of the daily budget overnight is to glance at the
// admin metrics card. By the time anyone notices, the damage to the
// monthly bill is already done.
//
// This worker emails the admins so they don't have to refresh the
// dashboard:
//
//   • Daily summary — once per UTC day at end-of-day
//     (DIGEST_DAILY_UTC_HOUR, default 23). Goes out even on quiet
//     days so admins get baseline visibility into traffic on the
//     endpoint.
//
//   • High-usage heads-up — sent the moment usage crosses a
//     configurable threshold (default 75%) OR the daily breaker
//     trips. Throttled to once per hour so a saturated breaker
//     doesn't spam the inbox every tick. The throttle resets at
//     UTC midnight together with the budget so a brand-new abuse
//     event the next morning still triggers.
//
// Recipients are platform admins (`users.role = 'admin'`) with an
// email on file, filtered by `notification_preferences.system_enabled`
// — the same opt-out hook the rest of the "system" category respects.
// Admins who haven't touched their preferences default to opt-in
// (matches `DEFAULT_PREFS.systemEnabled`).
//
// The worker reads the digest snapshot from the in-memory aggregator
// in `signup-assistant-rate-limit.ts`. That aggregator lives in
// process memory (not Redis) on purpose — see the comment over
// `recordSignupAssistantDigestHit` for why approximate per-replica
// numbers are acceptable for a heads-up email.

import { eq } from "drizzle-orm";
import {
  db,
  notificationPreferencesTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendSignupAssistantAbuseDigestEmail } from "./sendgrid";
import {
  getSignupAssistantDigestSnapshot,
  SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG,
  type SignupAssistantDigestSnapshot,
} from "./signup-assistant-rate-limit";

const DEFAULT_TICK_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_HIGH_USAGE_THRESHOLD = 0.75;
const DEFAULT_DIGEST_DAILY_UTC_HOUR = 23;
const HIGH_USAGE_THROTTLE_MS = 60 * 60 * 1000; // hourly cadence on escalation
const TOP_IPS_IN_EMAIL = 10;

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envHour(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < 0 || i > 23) return fallback;
  return i;
}

function highUsageThreshold(): number {
  // Clamp to (0, 1]. A non-positive or >1 override is meaningless so
  // we fall back rather than silently disabling the feature.
  const raw = envFloat("SIGNUP_ASSISTANT_DIGEST_HIGH_USAGE_THRESHOLD", DEFAULT_HIGH_USAGE_THRESHOLD);
  if (raw <= 0 || raw > 1) return DEFAULT_HIGH_USAGE_THRESHOLD;
  return raw;
}

function dailyDigestUtcHour(): number {
  return envHour("SIGNUP_ASSISTANT_DIGEST_DAILY_UTC_HOUR", DEFAULT_DIGEST_DAILY_UTC_HOUR);
}

function metricsUrl(): string | null {
  // Optional deep-link to the admin assistant metrics card. The web
  // app exposes an admin view; we only render the link when an
  // operator points us at the public origin so the email never has
  // a broken `localhost` anchor in production.
  const base =
    process.env.SIGNUP_ASSISTANT_DIGEST_DASHBOARD_URL ||
    process.env.PUBLIC_WEB_URL ||
    "";
  if (!base) return null;
  return base.replace(/\/+$/, "") + "/admin/assistant";
}

// Worker-local state. Reset between processes (acceptable: the
// throttle is bounded and the daily-summary key includes the UTC
// dayKey so a restart at most causes one extra email per day).
interface DigestState {
  /** UTC dayKey of the last successful daily-summary send. */
  lastDailySummaryDayKey: string | null;
  /** Wall-clock ms of the last successful high-usage send.
   *  Reset (along with `lastHighUsageDayKey`) when the day rolls
   *  over so a brand-new abuse event the next morning still fires. */
  lastHighUsageMs: number;
  lastHighUsageDayKey: string | null;
}

let state: DigestState = {
  lastDailySummaryDayKey: null,
  lastHighUsageMs: 0,
  lastHighUsageDayKey: null,
};

/** Test-only: wipe worker state between cases. */
export function __resetSignupAssistantDigestStateForTests(): void {
  state = {
    lastDailySummaryDayKey: null,
    lastHighUsageMs: 0,
    lastHighUsageDayKey: null,
  };
}

export interface DigestRecipient {
  email: string;
}

/**
 * Resolve admin recipients for the abuse digest. Joins on
 * `notification_preferences.system_enabled` with a default of TRUE
 * (matching the rest of the "system" category) so admins who never
 * touched their preferences are opted in.
 *
 * Filters out:
 *   • admins without an email on file
 *   • admins suspended via `users.suspended_at`
 *   • admins who explicitly turned off system notifications
 */
export async function loadDigestRecipients(): Promise<DigestRecipient[]> {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      suspendedAt: usersTable.suspendedAt,
      systemEnabled: notificationPreferencesTable.systemEnabled,
    })
    .from(usersTable)
    .leftJoin(
      notificationPreferencesTable,
      eq(notificationPreferencesTable.userId, usersTable.id),
    )
    .where(eq(usersTable.role, "admin"));
  const seen = new Set<string>();
  const recipients: DigestRecipient[] = [];
  for (const r of rows) {
    if (r.suspendedAt) continue;
    // Default-in: explicit `false` opts out, anything else (true or
    // null when no preferences row exists) opts in.
    if (r.systemEnabled === false) continue;
    const email = r.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ email });
  }
  return recipients;
}

export interface DigestDecision {
  send: boolean;
  reason: "daily_summary" | "high_usage" | null;
  /** Diagnostic note for logs / tests; not user-facing. */
  note: string;
}

/**
 * Decide whether to send a digest email this tick.
 *
 * Order of checks (high-usage before daily so we never delay an
 * abuse alert behind the once-per-day summary):
 *
 *   1. high_usage — `used / budget >= threshold` OR breaker tripped,
 *      and we haven't sent a high-usage email within
 *      HIGH_USAGE_THROTTLE_MS on the current dayKey. Throttle resets
 *      with the dayKey so a fresh abuse event the next morning still
 *      fires.
 *
 *   2. daily_summary — the wall clock has reached
 *      DIGEST_DAILY_UTC_HOUR (e.g. 23:00 UTC) and we haven't already
 *      sent today's summary. Always sends, even on quiet days, so
 *      admins get baseline visibility.
 *
 *   3. otherwise — nothing to do.
 *
 * Pure (no I/O), so this is the unit-testable core of the worker.
 */
export function decideDigest(
  now: Date,
  snapshot: SignupAssistantDigestSnapshot,
): DigestDecision {
  // Reset the high-usage throttle cross UTC-midnight: when the
  // snapshot's dayKey doesn't match the throttle's dayKey, treat the
  // throttle as cleared so a new abuse event in the new day fires
  // immediately rather than waiting an extra hour after midnight.
  const throttleActive =
    state.lastHighUsageDayKey === snapshot.dayKey &&
    now.getTime() - state.lastHighUsageMs < HIGH_USAGE_THROTTLE_MS;
  const budget = SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.dailyBudget;
  const usagePct = budget > 0 ? snapshot.totalDispatched / budget : 0;
  const breakerHit = snapshot.breakerTripped > 0;
  const highUsage = usagePct >= highUsageThreshold() || breakerHit;
  if (highUsage && !throttleActive) {
    return {
      send: true,
      reason: "high_usage",
      note: breakerHit
        ? "breaker tripped"
        : `usagePct=${usagePct.toFixed(2)} >= ${highUsageThreshold()}`,
    };
  }
  // Daily summary fires once per dayKey at/after the configured UTC
  // hour. We send even when nothing happened so admins get a
  // baseline pulse (and notice the complete absence of an email if
  // the worker silently dies).
  const targetHour = dailyDigestUtcHour();
  const reachedHour = now.getUTCHours() >= targetHour;
  if (reachedHour && state.lastDailySummaryDayKey !== snapshot.dayKey) {
    return {
      send: true,
      reason: "daily_summary",
      note: `utcHour=${now.getUTCHours()} >= ${targetHour}`,
    };
  }
  if (highUsage && throttleActive) {
    return { send: false, reason: null, note: "high_usage throttled" };
  }
  if (state.lastDailySummaryDayKey === snapshot.dayKey) {
    return { send: false, reason: null, note: "daily_summary already sent" };
  }
  return { send: false, reason: null, note: "below threshold and pre-window" };
}

export interface DigestRunResult {
  decision: DigestDecision;
  recipientCount: number;
  sent: boolean;
}

export async function runSignupAssistantDigestScan(
  now: Date = new Date(),
): Promise<DigestRunResult> {
  const snapshot = getSignupAssistantDigestSnapshot(TOP_IPS_IN_EMAIL, now.getTime());
  const decision = decideDigest(now, snapshot);
  if (!decision.send || !decision.reason) {
    return { decision, recipientCount: 0, sent: false };
  }
  const recipients = await loadDigestRecipients();
  if (recipients.length === 0) {
    logger.info(
      {
        kind: "signup_assistant.digest.skip",
        reason: decision.reason,
        note: "no admin recipients",
      },
      "signup-assistant digest skipped — no admin recipients",
    );
    return { decision, recipientCount: 0, sent: false };
  }
  try {
    await sendSignupAssistantAbuseDigestEmail({
      recipients: recipients.map((r) => r.email),
      reason: decision.reason,
      dayKey: snapshot.dayKey,
      used: snapshot.totalDispatched,
      budget: snapshotBudget(snapshot),
      totalRequests: snapshot.totalRequests,
      ipBlocks: snapshot.ipBlocks,
      breakerTripped: snapshot.breakerTripped,
      uniqueIps: snapshot.uniqueIps,
      topIps: snapshot.topIps,
      metricsUrl: metricsUrl(),
    });
    if (decision.reason === "high_usage") {
      state.lastHighUsageMs = now.getTime();
      state.lastHighUsageDayKey = snapshot.dayKey;
    } else {
      state.lastDailySummaryDayKey = snapshot.dayKey;
    }
    logger.info(
      {
        kind: "signup_assistant.digest.sent",
        reason: decision.reason,
        recipientCount: recipients.length,
        dayKey: snapshot.dayKey,
        totalRequests: snapshot.totalRequests,
        used: snapshot.totalDispatched,
        ipBlocks: snapshot.ipBlocks,
        breakerTripped: snapshot.breakerTripped,
      },
      "signup-assistant abuse digest sent",
    );
    return { decision, recipientCount: recipients.length, sent: true };
  } catch (err) {
    // Never throw out of the worker — a SendGrid 5xx must not crash
    // the interval. Log and let the next tick retry; the throttle is
    // only updated on success so a transient failure won't suppress
    // the next attempt.
    logger.error(
      { err, kind: "signup_assistant.digest.failed", reason: decision.reason },
      "signup-assistant digest send failed",
    );
    return { decision, recipientCount: recipients.length, sent: false };
  }
}

/**
 * The snapshot only carries the dispatched count, not the daily
 * budget — we read the budget from the rate-limit config helper at
 * email-build time. Kept as a tiny adapter so the email shape mirrors
 * what admins see on the dashboard tile.
 */
function snapshotBudget(_snapshot: SignupAssistantDigestSnapshot): number {
  return SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.dailyBudget;
}

let intervalHandle: NodeJS.Timeout | null = null;
let firstTickHandle: NodeJS.Timeout | null = null;

export function startSignupAssistantDigest(intervalMs = DEFAULT_TICK_MS): void {
  if (intervalHandle) return;
  // Defer the first tick so server boot doesn't block on a SendGrid
  // round-trip; no abuse event is going to fire in the first 60s of
  // process life that we couldn't catch on the next tick. We track
  // the timeout handle so a graceful shutdown (or a short-lived test
  // process) can cancel a still-pending first tick instead of having
  // it fire after stopSignupAssistantDigest() returns.
  firstTickHandle = setTimeout(() => {
    firstTickHandle = null;
    void runSignupAssistantDigestScan().catch((err) =>
      logger.error({ err }, "signup-assistant digest first tick crashed"),
    );
  }, 60 * 1000);
  intervalHandle = setInterval(() => {
    void runSignupAssistantDigestScan().catch((err) =>
      logger.error({ err }, "signup-assistant digest tick crashed"),
    );
  }, intervalMs);
  logger.info(
    {
      intervalMs,
      highUsageThreshold: highUsageThreshold(),
      dailyDigestUtcHour: dailyDigestUtcHour(),
    },
    "signup-assistant digest worker started",
  );
}

export function stopSignupAssistantDigest(): void {
  if (firstTickHandle) {
    clearTimeout(firstTickHandle);
    firstTickHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
