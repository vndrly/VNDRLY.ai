import { guardAdditiveReplay } from '../../../scripts/guard-additive-replay.mjs';
import { pool } from "@workspace/db";

/** Private server-owned delegation records; deliberately absent from user projections. */
async function main() {
  await pool.query(guardAdditiveReplay("ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_plan_executions jsonb"));
  console.log("Assistant plan execution additive migration complete");
}

main().then(() => pool.end()).catch(() => {
  console.error("Assistant plan execution migration failed");
  process.exitCode = 1;
  return pool.end();
});
