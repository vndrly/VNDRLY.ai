import { readFile } from "node:fs/promises";
import pg from "pg";
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");
const migration = await readFile(
  new URL("../../../lib/db/drizzle/gate_change_over.sql", import.meta.url),
  "utf8",
);
// This migration is API-private, additive DDL; never accept input SQL or URLs.
if (
  /\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i.test(
    migration,
  )
)
  throw new Error("Non-additive Change Over migration refused");
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query(migration);
  console.log("Change Over additive migration passed");
} finally {
  await client.end();
}
