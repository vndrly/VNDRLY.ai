import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export async function migrateGateMapPins() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect(); await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("ALTER TABLE vendors ADD COLUMN IF NOT EXISTS gate_map_pins jsonb NOT NULL DEFAULT '[]'::jsonb");
    await client.query("COMMIT");
    console.log("Company-shared Gate Map pins ready; existing records unchanged.");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { await client.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await migrateGateMapPins();
