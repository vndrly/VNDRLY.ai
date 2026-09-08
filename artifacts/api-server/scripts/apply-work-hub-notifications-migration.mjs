import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWorkHubNotificationsMigration } from "../../../scripts/work-hub-notifications-migration.mjs";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Work Hub notifications migration");
const migrationPath = fileURLToPath(new URL("../../../lib/db/drizzle/chunk_397_work_hub_notifications.sql", import.meta.url));
const client = new pg.Client({ connectionString: databaseUrl });
try { await client.connect(); await runWorkHubNotificationsMigration(client, await readFile(migrationPath, "utf8")); process.stdout.write("Work Hub notifications migration passed\n"); } finally { await client.end().catch(() => undefined); }
