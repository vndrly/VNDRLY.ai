import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { sendExpoPushDestination } from "../lib/expo-push";
import type { GateAlert, SendResult } from "./gate-alert-delivery";

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
    const fingerprint = createHash("sha256").update(token).digest("hex");
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
    [notice.id, fingerprint, attempt, result.status, result.providerMessageId ?? null, result.errorCode ?? null]);
    if (result.errorCode === "DeviceNotRegistered") {
      // Compare both owner and exact token: never remove a replacement registration.
      await pool.query("DELETE FROM field_push_tokens WHERE user_id = $1 AND expo_token = $2", [notice.userId, token]);
    }
  }));
  const outcomes = await pool.query("SELECT status FROM notification_push_deliveries WHERE notification_id = $1", [notice.id]);
  const statuses = outcomes.rows.map(row => row.status);
  const status = attempts.some(result => result.status === "rejected") || statuses.includes("retryable") ? "retryable" : statuses.some(s => ["unknown", "sending"].includes(s)) ? "unknown"
    : statuses.includes("accepted") ? "accepted" : statuses.length ? "failed" : "skipped";
  return { accepted: status === "accepted", status: status as "retryable" | "unknown" | "accepted" | "failed" | "skipped" };
}
