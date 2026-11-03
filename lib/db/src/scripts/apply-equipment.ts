import { pool } from "../index";

/** Additive only. Existing asset IDs, custody, aliases, holds and Fleet data stay authoritative. */
export const equipmentMigration = ["ALTER TABLE assets ADD COLUMN IF NOT EXISTS equipment_profile jsonb"] as const;

async function main() {
  const client = await pool.connect();
  try {
    // PostgreSQL checks ALTER ownership even when IF NOT EXISTS is a no-op.
    // The demo runtime role can read this owner-managed column but cannot DDL.
    const existing = await client.query<{ data_type: string }>(
      "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'equipment_profile'",
    );
    if (existing.rows.length) {
      if (existing.rows[0].data_type !== "jsonb") throw new Error("assets.equipment_profile must be jsonb");
      console.log("Shared equipment profile column already verified");
      return;
    }
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
