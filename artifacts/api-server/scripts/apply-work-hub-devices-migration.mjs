import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWorkHubDevicesMigration } from "../../../scripts/work-hub-devices-migration.mjs";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Work Hub devices migration");
const migrationPath = fileURLToPath(new URL("../../../lib/db/drizzle/chunk_410_work_hub_devices.sql", import.meta.url));
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await runWorkHubDevicesMigration(client, await readFile(migrationPath, "utf8"));
  process.stdout.write("Work Hub devices migration passed\n");
} finally {
  await client.end().catch(() => undefined);
}
