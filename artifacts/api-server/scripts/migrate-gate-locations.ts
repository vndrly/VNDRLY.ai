import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** An exact DDL allowlist prevents future edits from expanding this release migration. */
export function validateGateLocationMigration(sql: string): void {
  const statements = sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const allowed = new Set([
    "ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS latitude double precision",
    "ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS longitude double precision",
    "ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS geofence_radius_m integer NOT NULL DEFAULT 500",
    "ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true",
    "ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1",
    "CREATE INDEX IF NOT EXISTS gate_stations_site_active_idx ON gate_stations(site_id, active)",
  ]);
  if (
    statements.length !== allowed.size ||
    new Set(statements).size !== allowed.size ||
    statements.some((s) => !allowed.has(s))
  )
    throw new Error("Unsafe gate location migration refused");
}
async function main() {
  const sql = await readFile(
    new URL(
      "../../../lib/db/drizzle/gate_location_management.sql",
      import.meta.url,
    ),
    "utf8",
  );
  validateGateLocationMigration(sql);
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Gate location guarded additive migration passed");
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
