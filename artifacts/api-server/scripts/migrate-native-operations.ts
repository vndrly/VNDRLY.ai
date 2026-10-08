import { Pool } from "pg";
/** Additive authority state only. No new tables, data resets, or credential writes. */
export const nativeOperationsMigration = [
  "ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS gate_identity_document jsonb",
  "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS native_operations_policy jsonb NOT NULL DEFAULT '{}'::jsonb",
  "ALTER TABLE partners ADD COLUMN IF NOT EXISTS native_operations_policy jsonb NOT NULL DEFAULT '{}'::jsonb",
  "ALTER TABLE work_hub_device_preferences ADD COLUMN IF NOT EXISTS native_operations jsonb NOT NULL DEFAULT '{}'::jsonb",
  "ALTER TABLE work_hub_user_events ADD COLUMN IF NOT EXISTS retention_until timestamptz",
  "ALTER TABLE field_push_tokens ADD COLUMN IF NOT EXISTS native_device_id uuid",
];
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const sql of nativeOperationsMigration) await c.query(sql);
    await c.query("COMMIT");
    console.log("Native operations additive columns ready");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
