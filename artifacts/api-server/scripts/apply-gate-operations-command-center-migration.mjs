import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");

const migration = await readFile(
  new URL("../../../lib/db/drizzle/gate_operations_command_center.sql", import.meta.url),
  "utf8",
);

if (
  /\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i.test(
    migration,
  )
) {
  throw new Error("Non-additive Gate operations migration refused");
}

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query(migration);
  console.log("Gate operations additive migration passed");
} finally {
  await client.end();
}
