import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWorkHubCoreMigration } from "../../../scripts/work-hub-core-migration.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Work Hub core migration");
const migrationPath = fileURLToPath(new URL("../../../lib/db/drizzle/chunk_395_work_hub_core.sql", import.meta.url));
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await runWorkHubCoreMigration(client, await readFile(migrationPath, "utf8"));
  process.stdout.write("Work Hub core migration passed\n");
} finally {
  await client.end().catch(() => undefined);
}
