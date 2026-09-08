import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWorkHubImportsMigration } from "../../../scripts/work-hub-imports-migration.mjs";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl)
  throw new Error(
    "DATABASE_URL is required for the Work Hub imports migration",
  );
const migrationPath = fileURLToPath(
  new URL(
    "../../../lib/db/drizzle/chunk_398_work_hub_imports.sql",
    import.meta.url,
  ),
);
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await runWorkHubImportsMigration(
    client,
    await readFile(migrationPath, "utf8"),
  );
  process.stdout.write("Work Hub imports migration passed\n");
} finally {
  await client.end().catch(() => undefined);
}
