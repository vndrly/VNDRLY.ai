import { guardAdditiveReplay } from '../../../../scripts/guard-additive-replay.mjs';
import { pool } from "../index";

export const fleetResourcesMigration = [
  "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS fleet_resources jsonb",
] as const;

async function main() {
  const client = await pool.connect();
  try {
    await client.query(guardAdditiveReplay("BEGIN"));
    for (const statement of fleetResourcesMigration) await client.query(guardAdditiveReplay(statement));
    await client.query(guardAdditiveReplay("COMMIT"));
    console.log("Fleet resources column ready; existing Inventory and permissions preserved");
  } catch (error) {
    await client.query(guardAdditiveReplay("ROLLBACK"));
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
void main();
