import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
export async function migrateStaffRoleCatalog() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect(); await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("ALTER TABLE vendors ADD COLUMN IF NOT EXISTS staff_role_catalog jsonb");
    await client.query("COMMIT"); console.log("Staff role catalog column ready; existing staffing and access unchanged.");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { await client.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await migrateStaffRoleCatalog();
