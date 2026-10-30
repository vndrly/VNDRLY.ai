import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const STAFF_ENROLLMENT_MIGRATION = ["vendor_people", "user_org_memberships", "managed_subcontractor_worker_sponsorships"]
  .map(table => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS staff_enrollment jsonb;`).join("\n");
export async function migrateStaffEnrollment() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(STAFF_ENROLLMENT_MIGRATION);
    await client.query("COMMIT");
    console.log("Staff enrollment additive columns ready; no records or credentials changed.");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { await client.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await migrateStaffEnrollment();
