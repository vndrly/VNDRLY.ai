import { readFile } from "node:fs/promises";
import pg from "pg";
import { applyGateChangeOverMigration } from "../../../scripts/gate-change-over-migration.mjs";
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");
const migration = await readFile(
  new URL("../../../lib/db/drizzle/gate_change_over.sql", import.meta.url),
  "utf8",
);
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const result = await applyGateChangeOverMigration(client,migration);
  console.log(result.applied ? "Change Over additive migration passed" : "Change Over catalog already current; no DDL locks requested");
} finally {
  await client.end();
}
