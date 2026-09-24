import { pool } from "@workspace/db";

async function main() {
  await pool.query(`ALTER TABLE field_push_tokens ADD COLUMN IF NOT EXISTS retirement_pending boolean NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE field_push_tokens ADD COLUMN IF NOT EXISTS retirement_requested_at timestamptz`);
  await pool.query(`ALTER TABLE field_push_tokens ADD COLUMN IF NOT EXISTS retirement_lease_token text`);
  await pool.query(`ALTER TABLE field_push_tokens ADD COLUMN IF NOT EXISTS retirement_lease_until timestamptz`);
  await pool.query(`ALTER TABLE field_push_tokens ADD COLUMN IF NOT EXISTS retirement_attempt_count integer NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE field_push_tokens ADD COLUMN IF NOT EXISTS retirement_last_attempt_at timestamptz`);
  await pool.query(`CREATE INDEX IF NOT EXISTS field_push_tokens_retirement_idx ON field_push_tokens(retirement_pending, retirement_lease_until)`);
  console.log("Push token retirement additive migration complete");
}
main().then(() => pool.end()).catch(() => { console.error("Push token retirement migration failed"); process.exitCode = 1; return pool.end(); });
