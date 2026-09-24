import { pool } from "@workspace/db";

async function main() {
  await pool.query(`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS alerts_email_enabled boolean NOT NULL DEFAULT true`);
  await pool.query(`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS alerts_sms_enabled boolean NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS alerts_sms_opted_in_at timestamptz`);
  await pool.query(`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS alerts_sms_consent_fingerprint text`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notification_channel_deliveries (
    id serial PRIMARY KEY,
    notification_id integer NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    channel text NOT NULL,
    provider_message_id text,
    status text NOT NULL DEFAULT 'sending',
    attempt_token text NOT NULL,
    attempt_count integer NOT NULL DEFAULT 1,
    consent_fingerprint text,
    consent_opted_in_at timestamptz,
    last_error_code text,
    next_attempt_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS notification_channel_delivery_unique ON notification_channel_deliveries(notification_id, channel)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS notification_channel_attempt_unique ON notification_channel_deliveries(attempt_token)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS notification_channel_retry_idx ON notification_channel_deliveries(status, next_attempt_at)`);
  console.log("Gate alert channel additive migration complete");
}
main().then(() => pool.end()).catch(() => { console.error("Gate alert channel migration failed"); process.exitCode = 1; return pool.end(); });
