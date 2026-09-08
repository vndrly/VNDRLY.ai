import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWorkHubFlagsMigration } from "../../../scripts/work-hub-flags-migration.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Work Hub flags migration");

const migrationPath = fileURLToPath(new URL("../../../lib/db/drizzle/chunk_394_work_hub_flags.sql", import.meta.url));
const migrationSql = await readFile(migrationPath, "utf8");
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await runWorkHubFlagsMigration(client, migrationSql);
  process.stdout.write("Work Hub flags migration passed\n");
} finally {
  await client.end().catch(() => undefined);
}
