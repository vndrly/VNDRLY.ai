import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the real ticket boundary migration");
const migrationPath = fileURLToPath(new URL("../../../lib/db/drizzle/chunk_402_real_ticket_boundary.sql", import.meta.url));
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query(await readFile(migrationPath, "utf8"));
  process.stdout.write("Real ticket boundary migration passed\n");
} finally {
  await client.end().catch(() => undefined);
}
