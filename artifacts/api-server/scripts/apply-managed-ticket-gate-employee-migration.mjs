import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the managed ticket gate employee migration");
const migrationPath = fileURLToPath(new URL("../../../lib/db/drizzle/chunk_403_managed_ticket_gate_employee.sql", import.meta.url));
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query(await readFile(migrationPath, "utf8"));
  process.stdout.write("Managed ticket gate employee migration passed\n");
} finally {
  await client.end().catch(() => undefined);
}
