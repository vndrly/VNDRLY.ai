// Task #50 — Every-few-minutes "you have new comment replies" digest.
//
// `comment_added` and `hotlist_comment_added` notifications fire from
// /tickets/:id/comments and /hotlist/jobs/:id/comments whenever a
// non-mentioned participant on the thread gets a new reply. The notify
// pipeline deliberately leaves these rows with `emailed_at = NULL` so
// this worker can roll them up: a busy thread shouldn't drop one email
// per reply on every participant.
//
// Cadence: every 5 minutes. The worker:
//   1. Pulls every user who has at least one un-emailed `comment_added`
//      / `hotlist_comment_added` notification.
//   2. Checks each user's `commentReplyEmailEnabled` preference.
//   3. If on AND the user has a deliverable email, batches the user's
//      pending replies into a single SendGrid email.
//   4. Stamps `emailed_at = now()` on every pending row regardless of
//      whether email went out — turning the toggle off must STOP
//      emails, not pile up rows that never get emailed.
//
// Mentions follow the existing instant-alert path
// (`sendNotificationAlertEmail`) and are NOT touched by this worker.
//
// All work is best-effort; failures are logged and the worker keeps
// running so a single user's send error doesn't stall delivery for
// everybody else.

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  notificationsTable,
  notificationPreferencesTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  sendCommentReplyDigestEmail,
  type CommentReplyDigestItem,
} from "./sendgrid";
import { COMMENT_REPLY_NOTIFICATION_TYPES } from "../routes/notifications";

const REPLY_TYPES = [...COMMENT_REPLY_NOTIFICATION_TYPES];

export interface CommentReplyDigestRunSummary {
  usersConsidered: number;
  digestsSent: number;
  rowsMarked: number;
  errors: number;
}

/** Best-effort: derive a thread label from the in-app notification
 *  title. The notify pipeline writes titles like:
 *    "Jane Doe commented on tracking #0123"
 *    "Jane Doe commented on a Hotlist job"
 *  We strip the leading "<author> commented on " so the digest groups
 *  by the trailing thread label. The author line preserves the full
 *  title because that's what reads naturally as a sub-line. */
function deriveThreadLabel(title: string, source: "ticket" | "hotlist"): string {
  const match = title.match(/^.+? commented on (.+)$/i);
  if (match && match[1]) return match[1];
  return source === "ticket" ? "Ticket comment" : "Hotlist comment";
}

export async function runCommentReplyDigest(
  now: Date = new Date(),
): Promise<CommentReplyDigestRunSummary> {
  const summary: CommentReplyDigestRunSummary = {
    usersConsidered: 0,
    digestsSent: 0,
    rowsMarked: 0,
    errors: 0,
  };

  // Step 1 — find every user with at least one un-emailed reply row.
  const candidateRows = await db
    .selectDistinct({ userId: notificationsTable.userId })
    .from(notificationsTable)
    .where(
      and(
        inArray(notificationsTable.type, REPLY_TYPES),
        isNull(notificationsTable.emailedAt),
      ),
    );

  summary.usersConsidered = candidateRows.length;
  if (!candidateRows.length) return summary;

  const userIds = candidateRows.map((c) => c.userId);

  // Step 2 — pull prefs + contact info in batched lookups.
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

  for (const userId of userIds) {
    // Default-true semantics for users with no preferences row yet.
    const prefs = prefsById.get(userId);
    const replyEmailEnabled = prefs ? prefs.commentReplyEmailEnabled : true;

    const user = usersById.get(userId);
    const email = (user?.email?.trim() || user?.username?.trim() || "");
    const hasEmail = email.includes("@");

    // Pull this user's pending reply rows. We pull them all so we can
    // stamp `emailed_at` even on the rows we choose not to email — that
    // keeps the queue from growing forever when the user has the
    // toggle off (or no email on file).
    const rows = await db
      .select({
        id: notificationsTable.id,
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
          inArray(notificationsTable.type, REPLY_TYPES),
          isNull(notificationsTable.emailedAt),
        ),
      )
      .orderBy(notificationsTable.createdAt);

    if (!rows.length) continue;

    let sent = false;
    if (replyEmailEnabled && hasEmail) {
      const items: CommentReplyDigestItem[] = rows.map((r) => {
        const source: CommentReplyDigestItem["source"] =
          r.type === "hotlist_comment_added" ? "hotlist" : "ticket";
        return {
          source,
          threadLabel: deriveThreadLabel(r.title, source),
          authorLine: r.title,
          body: r.body,
          link: r.link,
          createdAt: r.createdAt,
        };
      });
      try {
        await sendCommentReplyDigestEmail({
          to: email,
          recipientName: user?.displayName ?? null,
          items,
        });
        sent = true;
        summary.digestsSent += 1;
      } catch (err) {
        logger.warn(
          { err, userId, count: items.length },
          "comment-reply-digest send failed; leaving rows unemailed for retry",
        );
        summary.errors += 1;
      }
    }

    // Stamp emailed_at unless we actually attempted-and-failed-to-send.
    // Reasoning: when the toggle is off OR there's no email on file
    // we don't want these rows hanging around in the queue forever.
    // When SendGrid succeeds we obviously stamp. The ONLY case we
    // leave rows in the queue is a transient SendGrid failure — that
    // way the next 5-minute tick will retry.
    const shouldStamp = sent || !replyEmailEnabled || !hasEmail;
    if (shouldStamp) {
      try {
        const updated = await db
          .update(notificationsTable)
          .set({ emailedAt: now })
          .where(inArray(notificationsTable.id, rows.map((r) => r.id)))
          .returning({ id: notificationsTable.id });
        summary.rowsMarked += updated.length;
      } catch (err) {
        logger.warn({ err, userId }, "comment-reply-digest: stamp emailedAt failed");
        summary.errors += 1;
      }
    }
  }

  if (summary.digestsSent > 0 || summary.errors > 0) {
    logger.info({ summary }, "Comment reply digest run complete");
  }
  return summary;
}

export async function runCommentReplyDigestSafe(): Promise<CommentReplyDigestRunSummary | null> {
  try {
    return await runCommentReplyDigest();
  } catch (err) {
    logger.error({ err }, "Comment reply digest crashed");
    return null;
  }
}

// Cadence — every 5 minutes. Short enough that participants on a busy
// thread feel responded-to, long enough that one email per reply
// becomes one email per burst.
export const COMMENT_REPLY_DIGEST_INTERVAL_MS = 5 * 60 * 1000;

let digestTimer: NodeJS.Timeout | null = null;

export function startCommentReplyDigest(): void {
  if (digestTimer) return;
  const tick = () => {
    void runCommentReplyDigestSafe();
    digestTimer = setTimeout(tick, COMMENT_REPLY_DIGEST_INTERVAL_MS);
  };
  // Stagger the first tick by a few seconds so a freshly booted server
  // doesn't try to flush the queue before SendGrid credentials are
  // resolved.
  digestTimer = setTimeout(tick, 30 * 1000);
}

export function stopCommentReplyDigest(): void {
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = null;
  }
}
