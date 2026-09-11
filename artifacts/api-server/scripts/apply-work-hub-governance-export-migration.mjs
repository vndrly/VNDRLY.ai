import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWorkHubGovernanceExportMigration } from "../../../scripts/work-hub-governance-export-migration.mjs";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Work Hub governance/export migration");
const migrationPath = fileURLToPath(new URL("../../../lib/db/drizzle/chunk_408_work_hub_governance_export.sql", import.meta.url));
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await runWorkHubGovernanceExportMigration(client, await readFile(migrationPath, "utf8"));
  process.stdout.write("Work Hub governance/export migration passed\n");
} finally { await client.end().catch(() => undefined); }
