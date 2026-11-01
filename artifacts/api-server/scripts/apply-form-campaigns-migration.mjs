import { readFile } from "node:fs/promises";
import pg from "pg";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the form campaigns migration");
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  // Even ADD COLUMN IF NOT EXISTS takes an exclusive table lock. Do not
  // request those locks on an already migrated, actively used Library.
  const expected = [
    ["work_hub_form_templates", "campaign_config", "jsonb"],
    ["work_hub_form_templates", "campaign_state", "jsonb"],
    ["work_hub_form_instances", "campaign_version", "integer"],
  ];
  const { rows } = await client.query(`SELECT table_name,column_name,data_type
    FROM information_schema.columns WHERE table_schema='public'
    AND ((table_name='work_hub_form_templates' AND column_name IN ('campaign_config','campaign_state'))
      OR (table_name='work_hub_form_instances' AND column_name='campaign_version'))`);
  for (const [table, column, type] of expected) {
    const existing = rows.find(row => row.table_name === table && row.column_name === column);
    if (existing && existing.data_type !== type) throw new Error(`Unexpected type for ${table}.${column}`);
  }
  if (expected.some(([table, column]) => !rows.some(row => row.table_name === table && row.column_name === column))) {
    const statements = (await readFile(new URL("../../../lib/db/drizzle/chunk_417_form_campaigns.sql", import.meta.url), "utf8")).split(';').map(s => s.trim()).filter(Boolean);
    await client.query("SET lock_timeout='5s'");
    for (const [table, column] of expected) {
      if (!rows.some(row => row.table_name === table && row.column_name === column)) {
        const statement = statements.find(s => s.startsWith(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} `));
        if (!statement) throw new Error(`Missing additive migration for ${table}.${column}`);
        await client.query(statement);
      }
    }
  }
  process.stdout.write("Form campaigns migration passed\n");
} finally { await client.end().catch(() => undefined); }

