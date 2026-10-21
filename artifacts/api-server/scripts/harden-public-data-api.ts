import { readFileSync } from "node:fs";
import pg from "pg";

if (process.env.APPLY_PUBLIC_DATA_API_HARDENING !== "1" || !process.env.DATABASE_URL) {
  throw new Error("Set APPLY_PUBLIC_DATA_API_HARDENING=1 and an explicit DATABASE_URL after target review");
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const retryableTransactionCodes = new Set(["40P01", "40001", "55P03"]);
const maxAttempts = 4;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  await client.connect();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
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
      break;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
      if (!code || !retryableTransactionCodes.has(code) || attempt === maxAttempts) {
        throw error;
      }
      const delayMilliseconds = 1_000 * 2 ** (attempt - 1);
      console.warn(`Public Data API hardening transaction conflicted (${code}); retrying attempt ${attempt + 1}/${maxAttempts} in ${delayMilliseconds}ms.`);
      await sleep(delayMilliseconds);
    }
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  const diagnostic = error instanceof Error
    ? { name: error.name, message: error.message, code: (error as Error & { code?: string }).code ?? null }
    : { name: "UnknownError", message: "Unknown database hardening failure", code: null };
  console.error("Public Data API hardening failed; transaction rolled back.", JSON.stringify(diagnostic));
  process.exitCode = 1;
} finally {
  await client.end();
}
