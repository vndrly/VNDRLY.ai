import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { sendExpoPushDestination } from "../lib/expo-push";
import type { GateAlert, SendResult } from "./gate-alert-delivery";

type StaleDestination = { notificationId: number; userId: number; destinationHash: string };
const destinationHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Idempotent cleanup: the audit remains cleanup_pending until the exact registration is gone. */
async function retireStaleDestination(destination: StaleDestination) {
  const { rows } = await pool.query("SELECT expo_token AS token FROM field_push_tokens WHERE user_id = $1", [destination.userId]);
  for (const { token } of rows) {
    if (destinationHash(token) === destination.destinationHash)
      await pool.query("DELETE FROM field_push_tokens WHERE user_id = $1 AND expo_token = $2", [destination.userId, token]);
  }
  await pool.query(`UPDATE notification_push_deliveries SET status = 'failed', updated_at = now()
    WHERE notification_id = $1 AND destination_hash = $2 AND status = 'cleanup_pending'
      AND last_error_code = 'DeviceNotRegistered'`, [destination.notificationId, destination.destinationHash]);
}

/** Runs independently of notification authorization and exhausted provider retry budgets. No sends. */
export async function retryGateAlertPushCleanup(): Promise<void> {
  const { rows } = await pool.query(`SELECT d.notification_id AS "notificationId", n.user_id AS "userId", d.destination_hash AS "destinationHash"
    FROM notification_push_deliveries d JOIN notifications n ON n.id = d.notification_id
    WHERE d.status = 'cleanup_pending' AND d.last_error_code = 'DeviceNotRegistered' ORDER BY d.updated_at LIMIT 100`);
  await Promise.allSettled(rows.map(row => retireStaleDestination(row)));
}

/** Audit stores hashes, never device tokens. Claims persist before contacting Expo. */
export async function sendGateAlertPush(notice: GateAlert, badge: number): Promise<SendResult> {
  try { return await sendDestinations(notice, badge); }
  catch {
    // Database reads/audits can be retried: accepted or uncertain destination claims are never reclaimed.
    return { accepted: false, status: "retryable", errorCode: "storage_unavailable" };
  }
}

async function sendDestinations(notice: GateAlert, badge: number): Promise<SendResult> {
  const { rows } = await pool.query("SELECT expo_token AS token FROM field_push_tokens WHERE user_id = $1", [notice.userId]);
  const attempts = await Promise.allSettled(rows.map(async ({ token }: { token: string }) => {
    const fingerprint = destinationHash(token);
    // A previous notification already established this user's token is stale. Never send to it again.
    const stale = await pool.query(`SELECT d.notification_id AS "notificationId", n.user_id AS "userId", d.destination_hash AS "destinationHash"
      FROM notification_push_deliveries d JOIN notifications n ON n.id = d.notification_id
      WHERE n.user_id = $1 AND d.destination_hash = $2 AND d.last_error_code = 'DeviceNotRegistered'`, [notice.userId, fingerprint]);
    if (stale.rows.length) {
      await Promise.all(stale.rows.map(row => retireStaleDestination(row)));
      return;
    }
    const attempt = randomUUID();
    const claim = await pool.query(`INSERT INTO notification_push_deliveries (notification_id,destination_hash,attempt_token)
      VALUES ($1,$2,$3) ON CONFLICT (notification_id,destination_hash) DO UPDATE SET
      status = 'sending', attempt_token = EXCLUDED.attempt_token, attempt_count = notification_push_deliveries.attempt_count + 1, updated_at = now()
      WHERE notification_push_deliveries.status = 'retryable' AND notification_push_deliveries.attempt_count < 3 RETURNING id`, [notice.id, fingerprint, attempt]);
    if (!claim.rows.length) return;
    const result = await sendExpoPushDestination(token, { title: notice.title, body: notice.body ?? "", badge,
      data: { type: notice.type, link: notice.link, notificationId: notice.id, category: "alerts" } });
    await pool.query(`UPDATE notification_push_deliveries SET status = CASE WHEN $4 = 'retryable' AND attempt_count >= 3 THEN 'failed' ELSE $4 END,
      provider_message_id = $5, last_error_code = $6, updated_at = now()
      WHERE notification_id = $1 AND destination_hash = $2 AND attempt_token = $3 AND status = 'sending'`,
    [notice.id, fingerprint, attempt, result.errorCode === "DeviceNotRegistered" ? "cleanup_pending" : result.status, result.providerMessageId ?? null, result.errorCode ?? null]);
    if (result.errorCode === "DeviceNotRegistered") {
      await retireStaleDestination({ notificationId: notice.id, userId: notice.userId, destinationHash: fingerprint });
    }
  }));
  const outcomes = await pool.query("SELECT status FROM notification_push_deliveries WHERE notification_id = $1", [notice.id]);
  const statuses = outcomes.rows.map(row => row.status);
  const status = attempts.some(result => result.status === "rejected") || statuses.some(s => ["retryable", "cleanup_pending"].includes(s)) ? "retryable" : statuses.some(s => ["unknown", "sending"].includes(s)) ? "unknown"
    : statuses.includes("accepted") ? "accepted" : statuses.length ? "failed" : "skipped";
  return { accepted: status === "accepted", status: status as "retryable" | "unknown" | "accepted" | "failed" | "skipped" };
}
