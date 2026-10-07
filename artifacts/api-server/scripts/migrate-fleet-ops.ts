import { pool } from "@workspace/db";
async function main() { await pool.query("ALTER TABLE vendors ADD COLUMN IF NOT EXISTS fleet_ops_state jsonb"); console.log("Fleet additive migration complete"); }
main().catch(() => { console.error("Fleet migration failed"); process.exitCode = 1; }).finally(() => pool.end());
