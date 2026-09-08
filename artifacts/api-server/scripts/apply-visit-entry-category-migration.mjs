import { readFile } from "node:fs/promises";
import pg from "pg";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for visit-entry-category migration");
const migrationSql = await readFile(new URL("../../../lib/db/drizzle/list_one_visit_entry_category.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query(migrationSql);
  const result = await client.query("SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'site_visits' AND column_name = 'entry_category'");
  if (result.rows.length !== 1 || result.rows[0].data_type !== "text" || result.rows[0].is_nullable !== "YES") throw new Error("Visit category requires a nullable text column");
  await client.query("COMMIT");
  process.stdout.write("Visit entry category verified; legacy records remain unclassified.\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally { await client.end(); }
