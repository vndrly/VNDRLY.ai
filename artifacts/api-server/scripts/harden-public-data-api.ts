import { readFileSync } from "node:fs";
import pg from "pg";

if (process.env.APPLY_PUBLIC_DATA_API_HARDENING !== "1" || !process.env.DATABASE_URL) {
  throw new Error("Set APPLY_PUBLIC_DATA_API_HARDENING=1 and an explicit DATABASE_URL after target review");
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SELECT pg_advisory_xact_lock(90407004)");
  await client.query(readFileSync(new URL("./harden-public-data-api.sql", import.meta.url), "utf8"));
  const { rows } = await client.query(`SELECT
    (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('anon','authenticated')) AS restricted_roles,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity) AS rls_tables,
    (SELECT count(*)::int FROM pg_default_acl a JOIN pg_roles r ON r.oid=a.defaclrole
      JOIN pg_namespace n ON n.oid=a.defaclnamespace
      WHERE n.nspname='public' AND r.rolname='supabase_admin') AS managed_default_acl_entries`);
  await client.query("COMMIT");
  console.log(JSON.stringify({ ...rows[0], managedDefaultsProtectedBySchemaDenial: rows[0].restricted_roles > 0 }));
} catch {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Public Data API hardening failed; transaction rolled back. Review database permissions without logging credentials.");
  process.exitCode = 1;
} finally {
  await client.end();
}
