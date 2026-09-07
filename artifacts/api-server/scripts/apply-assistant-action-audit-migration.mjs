import { readFile } from "node:fs/promises";
import pg from "pg";
import { runAssistantActionAuditMigration } from "../../../scripts/assistant-action-audit-migration.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the assistant action audit migration");
const migrationSql = await readFile(new URL("../../../lib/db/drizzle/chunk_388_assistant_action_audit.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await runAssistantActionAuditMigration(client, migrationSql);
  process.stdout.write("assistant_action_audit migration/preflight passed: schema verified, RLS enabled, browser roles denied\n");
} finally {
  await client.end().catch(() => undefined);
}
