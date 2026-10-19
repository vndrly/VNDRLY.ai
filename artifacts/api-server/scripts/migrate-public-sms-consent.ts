import { pool } from "@workspace/db";
async function main() {
  await pool.query("ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS sms_consent_record jsonb");
  console.log("Public SMS consent additive migration complete");
}
main().then(() => pool.end()).catch(() => { console.error("Public SMS consent migration failed"); process.exitCode = 1; return pool.end(); });
