import { pool } from "../index";

/** Additive only. Existing asset IDs, custody, aliases, holds and Fleet data stay authoritative. */
export const equipmentMigration = ["ALTER TABLE assets ADD COLUMN IF NOT EXISTS equipment_profile jsonb"] as const;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of equipmentMigration) await client.query(statement);
    await client.query("COMMIT");
    console.log("Shared equipment profile column ready");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
void main();
