import { readFile } from "node:fs/promises"; import { fileURLToPath } from "node:url"; import pg from "pg";
import { runWorkHubCoreMigration } from "../../../scripts/work-hub-core-migration.mjs";
const databaseUrl = process.env.DATABASE_URL?.trim(); if (!databaseUrl) throw new Error("DATABASE_URL is required for the Work Hub domains migration");
const migrationPath = fileURLToPath(new URL("../../../lib/db/drizzle/chunk_396_work_hub_domains.sql", import.meta.url)); const client = new pg.Client({ connectionString: databaseUrl });
try { await client.connect(); await runWorkHubCoreMigration(client, await readFile(migrationPath, "utf8")); process.stdout.write("Work Hub domains migration passed\n"); } finally { await client.end().catch(() => undefined); }
