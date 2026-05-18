// Task #47 — Daily notification email digest
//
// When a user opts into `emailDigestEnabled`, the live `notifyUsers`
// pipeline sends instant emails ONLY for high-priority types
// (`ticket_kicked_back`, `cert_expired`, `job_awarded`). Every other
// alert is left with `notifications.emailed_at = NULL` so this worker
// can roll the day's chatty stuff (note added, hotlist match, long
// check-in, etc.) into one email per user per day.
//
// The worker runs once per day (~07:00 UTC) and:
//   1. Pulls every user with `email_digest_enabled = true` who has at
//      least one un-emailed notification.
//   2. For each, fetches all of their un-emailed rows whose category
//      currently has email delivery enabled (so toggling a category
//      off retroactively suppresses pending digests for it).
//   3. Sends a single SendGrid email summarising the rows, then
//      stamps `emailed_at = now()` on every row that was either
//      included OR ineligible (so we don't re-scan suppressed rows
//      forever).
//   4. Skips users with no email on file or no eligible items.
//
// All work is best-effort; failures are logged but never thrown so the
// worker keeps marching through the next user.

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  notificationsTable,
  notificationPreferencesTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  sendNotificationDigestEmail,
  type NotificationDigestItem,
} from "./sendgrid";

// Categories that gate which un-emailed rows are eligible for the
// digest. Mirrors `categoryEmailEnabled` in routes/notifications.ts but
// kept inline so the worker doesn't import the routes module (which
// would pull express + the rate-limit table into a worker context).
function categoryEmailEnabledForRow(
  category: string,
  prefs: {
    ticketsEmailEnabled: boolean;
    hotlistEmailEnabled: boolean;
    complianceEmailEnabled: boolean;
    crewEmailEnabled: boolean;
    systemEmailEnabled: boolean;
    visitorEmailEnabled: boolean;
  },
): boolean {
  switch (category) {
    case "tickets":
      return prefs.ticketsEmailEnabled;
    case "hotlist":
      return prefs.hotlistEmailEnabled;
    case "compliance":
      return prefs.complianceEmailEnabled;
    case "crew":
      return prefs.crewEmailEnabled;
    case "system":
      return prefs.systemEmailEnabled;
    case "visitor":
      return prefs.visitorEmailEnabled;
    // Task #50 — comments-thread alerts have their own dedicated
    // delivery paths (instant for mentions, every-few-minutes for
    // replies) and are NEVER rolled into the once-a-day digest. The
    // worker still stamps `emailedAt` on their rows so they don't pile
    // up if the reply-digest worker is offline; they just don't appear
    // in the daily summary email.
    case "comments":
      return false;
    default:
      return false;
  }
}

function formatDayLabel(d: Date): string {
  // Locale-agnostic, deterministic. e.g. "May 1, 2026".
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export interface DigestRunSummary {
  usersConsidered: number;
  digestsSent: number;
  rowsMarked: number;
  errors: number;
}

export async function runNotificationEmailDigest(
  now: Date = new Date(),
): Promise<DigestRunSummary> {
  const summary: DigestRunSummary = {
    usersConsidered: 0,
    digestsSent: 0,
    rowsMarked: 0,
    errors: 0,
  };

  // Step 1: find candidate users — those with digest mode on AND at
  // least one un-emailed notification. A single SQL pass keeps the
  // worker from scanning the prefs table for users who have nothing
  // queued.
  const candidates = await db
    .selectDistinct({ userId: notificationPreferencesTable.userId })
    .from(notificationPreferencesTable)
    .innerJoin(
      notificationsTable,
      and(
        eq(notificationsTable.userId, notificationPreferencesTable.userId),
        isNull(notificationsTable.emailedAt),
      ),
    )
    .where(eq(notificationPreferencesTable.emailDigestEnabled, true));

  summary.usersConsidered = candidates.length;
  if (!candidates.length) return summary;

  const userIds = candidates.map((c) => c.userId);

  // Step 2: pull prefs + user contact info for the candidate set in
  // two batched lookups so we don't fire one query per user.
  const prefsRows = await db
    .select()
    .from(notificationPreferencesTable)
    .where(inArray(notificationPreferencesTable.userId, userIds));
  const prefsById = new Map(prefsRows.map((r) => [r.userId, r]));

  const userRows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      username: usersTable.username,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));
  const usersById = new Map(userRows.map((r) => [r.id, r]));

  const dayLabel = formatDayLabel(now);

  for (const userId of userIds) {
    const prefs = prefsById.get(userId);
    const user = usersById.get(userId);
    if (!prefs || !user) continue;

    const email = user.email?.trim() || user.username?.trim() || "";
    if (!email.includes("@")) {
      // No deliverable address — mark all un-emailed rows so we don't
      // keep re-considering this user every day.
      try {
        const updated = await db
          .update(notificationsTable)
          .set({ emailedAt: now })
          .where(
            and(
              eq(notificationsTable.userId, userId),
              isNull(notificationsTable.emailedAt),
            ),
          )
          .returning({ id: notificationsTable.id });
        summary.rowsMarked += updated.length;
      } catch (err) {
        logger.warn({ err, userId }, "digest: mark-without-email failed");
        summary.errors += 1;
      }
      continue;
    }

    // Step 3: collect this user's un-emailed rows. We pull every row
    // (regardless of category) so we can mark ineligible rows
    // emailed-at too — that prevents a row in a category the user
    // turned email off for from sticking around forever.
    const rows = await db
      .select({
        id: notificationsTable.id,
        category: notificationsTable.category,
        type: notificationsTable.type,
        title: notificationsTable.title,
        body: notificationsTable.body,
        link: notificationsTable.link,
        createdAt: notificationsTable.createdAt,
      })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          isNull(notificationsTable.emailedAt),
        ),
      )
      .orderBy(notificationsTable.createdAt);

    if (!rows.length) continue;

    const includedItems: NotificationDigestItem[] = [];
    const allRowIds: number[] = [];
    for (const r of rows) {
      allRowIds.push(r.id);
      if (categoryEmailEnabledForRow(r.category, prefs)) {
        includedItems.push({
          category: r.category,
          title: r.title,
          body: r.body,
          link: r.link,
          createdAt: r.createdAt,
        });
      }
    }

    // Cap items in the email body — extremely chatty days shouldn't
    // produce a multi-megabyte HTML payload. We still mark every row
    // emailed so the cap doesn't drag forward forever.
    const MAX_DIGEST_ITEMS = 100;
    const trimmed = includedItems.slice(0, MAX_DIGEST_ITEMS);

    let sent = false;
    if (trimmed.length > 0) {
      try {
        await sendNotificationDigestEmail({
          to: email,
          recipientName: user.displayName ?? null,
          dayLabel,
          items: trimmed,
        });
        sent = true;
        summary.digestsSent += 1;
      } catch (err) {
        logger.warn(
          { err, userId, count: trimmed.length },
          "digest send failed; leaving rows unemailed for retry",
        );
        summary.errors += 1;
      }
    }

    // If the send succeeded (or there was nothing eligible), mark all
    // un-emailed rows so we don't re-process them tomorrow. If the
    // send FAILED, leave them so the next run retries.
    if (sent || trimmed.length === 0) {
      try {
        const updated = await db
          .update(notificationsTable)
          .set({ emailedAt: now })
          .where(inArray(notificationsTable.id, allRowIds))
          .returning({ id: notificationsTable.id });
        summary.rowsMarked += updated.length;
      } catch (err) {
        logger.warn({ err, userId }, "digest: stamp emailedAt failed");
        summary.errors += 1;
      }
    }
  }

  if (summary.digestsSent > 0 || summary.errors > 0) {
    logger.info({ summary }, "Notification email digest run complete");
  }
  return summary;
}

// Public helper for tests / admin endpoints.
export async function runNotificationEmailDigestSafe(): Promise<DigestRunSummary | null> {
  try {
    return await runNotificationEmailDigest();
  } catch (err) {
    logger.error({ err }, "Notification email digest crashed");
    return null;
  }
}

// Schedule one digest per day. We pick 14:00 UTC because:
//   • It's mid-morning in the US (covers East Coast at 9am).
//   • It's late afternoon in EU (covers operations teams there).
// Crews working overnight still get their high-priority alerts
// instantly via the inline path; the digest is purely the low-priority
// roll-up.
const DIGEST_HOUR_UTC = 14;

function msUntilNextRun(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(DIGEST_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startNotificationEmailDigest(): void {
  const tick = () => {
    void runNotificationEmailDigestSafe();
    // Re-arm for ~24h. We use setTimeout (not setInterval) so a long
    // run doesn't pile up overlapping ticks.
    setTimeout(tick, 24 * 60 * 60 * 1000);
  };
  setTimeout(tick, msUntilNextRun());
}

// Exported for tests so they can pin the schedule hour.
export const __DIGEST_HOUR_UTC__ = DIGEST_HOUR_UTC;
