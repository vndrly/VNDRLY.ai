import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";

const rawUrl = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1"
  ? process.env.TEST_DATABASE_URL : undefined;
const target = rawUrl ? new URL(rawUrl) : null;
const enabled = !!target && ["localhost", "127.0.0.1", "::1"].includes(target.hostname) && /_test$/.test(target.pathname);
const migration = readFileSync(new URL("../../scripts/harden-public-data-api.sql", import.meta.url), "utf8");

describe.skipIf(!enabled)("public Data API hardening in a fresh isolated PostgreSQL cluster", () => {
  it("denies public roles, preserves owner/service access, closes defaults and is repeatable", async () => {
    const client = new pg.Client({ connectionString: rawUrl });
    try {
      await client.connect();
      await client.query("BEGIN");
      // Reproduce the reviewed production identity only in this rollback-only
      // local fixture; the SQL intentionally rejects other backend identities.
      await client.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='postgres') THEN
          CREATE ROLE postgres NOLOGIN SUPERUSER BYPASSRLS;
        END IF;
      END $$; SET LOCAL ROLE postgres`);
      const owner = (await client.query<{ owner: string }>("SELECT current_user AS owner")).rows[0].owner;
      const ownerRole = `"${owner.replace(/"/g, '""')}"`;
      // These roles and fixtures exist only inside this rolled-back transaction,
      // and role creation is gated above by the fresh-local cluster marker.
      await client.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END $$;
      CREATE TABLE public.hardening_test_company (id serial PRIMARY KEY, secret text);
      INSERT INTO public.hardening_test_company(secret) VALUES ('preserved');
      CREATE VIEW public.hardening_test_view AS SELECT * FROM public.hardening_test_company;
      CREATE FUNCTION public.hardening_test_rpc() RETURNS text LANGUAGE sql SECURITY DEFINER
        AS 'SELECT secret FROM public.hardening_test_company LIMIT 1';
      GRANT ALL ON public.hardening_test_company, public.hardening_test_view TO PUBLIC, anon, authenticated, service_role;
      GRANT SELECT(secret) ON public.hardening_test_company TO anon;
      GRANT ALL ON SEQUENCE public.hardening_test_company_id_seq TO PUBLIC, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.hardening_test_rpc() TO PUBLIC, anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;`);
      expect((await client.query("SELECT has_table_privilege('anon','public.hardening_test_company','SELECT') AS allowed")).rows[0].allowed).toBe(true);
      await client.query(migration);
      await client.query(migration);
      for (const role of ["anon", "authenticated"]) {
        const result = await client.query(`SELECT
          has_table_privilege($1,'public.hardening_test_company','SELECT') AS table_read,
          has_any_column_privilege($1,'public.hardening_test_company','SELECT') AS column_read,
          has_table_privilege($1,'public.hardening_test_view','SELECT') AS view_read,
          has_sequence_privilege($1,'public.hardening_test_company_id_seq','USAGE') AS sequence_use,
          has_function_privilege($1,'public.hardening_test_rpc()','EXECUTE') AS rpc_execute`, [role]);
        expect(Object.values(result.rows[0])).toEqual([false, false, false, false, false]);
        await client.query("SAVEPOINT denied_read");
        await client.query(`SET LOCAL ROLE ${role}`);
        await expect(client.query("SELECT * FROM public.hardening_test_company")).rejects.toMatchObject({ code: "42501" });
        await client.query("ROLLBACK TO SAVEPOINT denied_read");
      }
      expect((await client.query("SELECT secret FROM public.hardening_test_company")).rows).toEqual([{ secret: "preserved" }]);
      await client.query("SET LOCAL ROLE service_role");
      expect((await client.query("SELECT public.hardening_test_rpc() AS secret")).rows[0].secret).toBe("preserved");
      await client.query("SET LOCAL ROLE postgres");
      const rls = await client.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.hardening_test_company'::regclass");
      expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
      await client.query("CREATE TABLE public.hardening_test_future(id integer); CREATE FUNCTION public.hardening_test_future_rpc() RETURNS integer LANGUAGE sql AS 'SELECT 1'");
      const future = await client.query("SELECT has_table_privilege('anon','public.hardening_test_future','SELECT') AS table_read, has_function_privilege('anon','public.hardening_test_future_rpc()','EXECUTE') AS rpc_execute");
      expect(future.rows[0]).toEqual({ table_read: false, rpc_execute: false });
      // A managed creator may still automatically grant table access. Schema
      // denial must remain an independent boundary against those future grants.
      await client.query("GRANT SELECT ON public.hardening_test_future TO anon");
      await client.query("SAVEPOINT future_denied");
      await client.query("SET LOCAL ROLE anon");
      await expect(client.query("SELECT * FROM public.hardening_test_future")).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT future_denied");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});
