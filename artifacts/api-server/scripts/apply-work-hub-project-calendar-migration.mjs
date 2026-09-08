import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Work Hub project calendar migration");
const migrationPath = fileURLToPath(new URL("../../../lib/db/drizzle/chunk_401_work_hub_project_calendar.sql", import.meta.url));
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query(await readFile(migrationPath, "utf8"));
  process.stdout.write("Work Hub project calendar migration passed\n");
} finally {
  await client.end().catch(() => undefined);
}
