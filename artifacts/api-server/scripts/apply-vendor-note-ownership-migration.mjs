import { readFile } from "node:fs/promises";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for vendor-note-ownership migration");
const migrationSql = await readFile(new URL("../../../lib/db/drizzle/list_one_vendor_note_ownership.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query(migrationSql);
  const result = await client.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vendor_notes' AND column_name IN ('owner_org_type', 'owner_org_id')");
  const expected = { owner_org_type: "text", owner_org_id: "integer" };
  if (result.rows.length !== 2 || result.rows.some(row => expected[row.column_name] !== row.data_type || row.is_nullable !== "YES")) {
    throw new Error("Vendor note ownership schema differs from expected nullable text/integer columns");
  }
  await client.query("COMMIT");
  process.stdout.write("Vendor note ownership migration verified; legacy notes preserved without ownership.\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
