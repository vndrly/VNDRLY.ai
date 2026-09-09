import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Work Hub meeting collaboration migration");
const migrationPath = fileURLToPath(new URL("../../../../lib/db/drizzle/chunk_402_work_hub_meeting_collaboration.sql", import.meta.url));
const sql = await readFile(migrationPath, "utf8");
const statements = sql.split(";").map((value) => value.trim()).filter(Boolean);
for (const statement of statements) {
  if (!/^ALTER TABLE [a-z_]+ ADD COLUMN IF NOT EXISTS /i.test(statement) || /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i.test(statement)) {
    throw new Error(`Unsafe Work Hub meeting migration statement: ${statement.slice(0, 100)}`);
  }
}
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  for (const statement of statements) await client.query(statement);
  process.stdout.write("Work Hub meeting collaboration migration passed\n");
} finally {
  await client.end().catch(() => undefined);
}
