import { pool } from "@workspace/db";

async function main() {
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_oauth_grants jsonb");
  console.log("Assistant connection additive migration complete");
}
main().then(() => pool.end()).catch(() => {
  console.error("Assistant connection migration failed");
  process.exitCode = 1;
  return pool.end();
});
