import { pool } from "../index";

export const fleetResourcesMigration = [
  "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS fleet_resources jsonb",
] as const;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of fleetResourcesMigration) await client.query(statement);
    await client.query("COMMIT");
    console.log("Fleet resources column ready; existing Inventory and permissions preserved");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
void main();
