import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { sendExpoPushDestination } from "../lib/expo-push";
import type { GateAlert, SendResult } from "./gate-alert-delivery";

type StaleRegistration = { id: number; userId: number };
const destinationHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Leased, registration-owned cleanup. Failure/crash keeps the barrier until a later worker succeeds. */
async function retireStaleRegistration(registration: StaleRegistration) {
  const lease = randomUUID();
  const claim = await pool.query(`UPDATE field_push_tokens SET retirement_lease_token = $3,
    retirement_lease_until = now() + interval '1 minute', retirement_attempt_count = retirement_attempt_count + 1,
    retirement_last_attempt_at = now()
    WHERE id = $1 AND user_id = $2 AND retirement_pending = true
      AND (retirement_lease_until IS NULL OR retirement_lease_until <= now()) RETURNING id`, [registration.id, registration.userId, lease]);
  if (!claim.rows.length) return;
  // ID protects a newly registered replacement; lease protects against a superseded worker.
  await pool.query(`DELETE FROM field_push_tokens WHERE id = $1 AND user_id = $2
    AND retirement_pending = true AND retirement_lease_token = $3`, [registration.id, registration.userId, lease]);
}

/** Runs independently of notification authorization and exhausted provider retry budgets. No sends. */
export async function retryGateAlertPushCleanup(): Promise<void> {
  const { rows } = await pool.query(`SELECT id, user_id AS "userId" FROM field_push_tokens
    WHERE retirement_pending = true AND (retirement_lease_until IS NULL OR retirement_lease_until <= now())
    ORDER BY retirement_requested_at, id LIMIT 100`);
  await Promise.allSettled(rows.map(row => retireStaleRegistration(row)));
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
  const { rows } = await pool.query("SELECT id, expo_token AS token FROM field_push_tokens WHERE user_id = $1 AND retirement_pending = false", [notice.userId]);
  const attempts = await Promise.allSettled(rows.map(async ({ id, token }: { id: number; token: string }) => {
    const fingerprint = destinationHash(token);
    const attempt = randomUUID();
    const claim = await pool.query(`INSERT INTO notification_push_deliveries (notification_id,destination_hash,attempt_token)
      VALUES ($1,$2,$3) ON CONFLICT (notification_id,destination_hash) DO UPDATE SET
      status = 'sending', attempt_token = EXCLUDED.attempt_token, attempt_count = notification_push_deliveries.attempt_count + 1, updated_at = now()
      WHERE notification_push_deliveries.status = 'retryable' AND notification_push_deliveries.attempt_count < 3 RETURNING id`, [notice.id, fingerprint, attempt]);
    if (!claim.rows.length) return;
    const result = await sendExpoPushDestination(token, { title: notice.title, body: notice.body ?? "", badge,
      data: { type: notice.type, link: notice.link, notificationId: notice.id, category: "alerts" } });
    if (result.errorCode === "DeviceNotRegistered") {
      // Persist before touching the notification audit: an inbox cascade must never erase this barrier.
      // The immutable registration ID identifies the token even if it switched accounts during the send.
      await pool.query(`UPDATE field_push_tokens SET retirement_pending = true,
        retirement_requested_at = COALESCE(retirement_requested_at, now()) WHERE id = $1`, [id]);
    }
    await pool.query(`UPDATE notification_push_deliveries SET status = CASE WHEN $4 = 'retryable' AND attempt_count >= 3 THEN 'failed' ELSE $4 END,
      provider_message_id = $5, last_error_code = $6, updated_at = now()
      WHERE notification_id = $1 AND destination_hash = $2 AND attempt_token = $3 AND status = 'sending'`,
    [notice.id, fingerprint, attempt, result.status, result.providerMessageId ?? null, result.errorCode ?? null]);
    if (result.errorCode === "DeviceNotRegistered") {
      await retireStaleRegistration({ id, userId: notice.userId });
    }
  }));
  const outcomes = await pool.query("SELECT status FROM notification_push_deliveries WHERE notification_id = $1", [notice.id]);
  const statuses = outcomes.rows.map(row => row.status);
  const status = attempts.some(result => result.status === "rejected") || statuses.some(s => ["retryable", "cleanup_pending"].includes(s)) ? "retryable" : statuses.some(s => ["unknown", "sending"].includes(s)) ? "unknown"
    : statuses.includes("accepted") ? "accepted" : statuses.length ? "failed" : "skipped";
  return { accepted: status === "accepted", status: status as "retryable" | "unknown" | "accepted" | "failed" | "skipped" };
}
