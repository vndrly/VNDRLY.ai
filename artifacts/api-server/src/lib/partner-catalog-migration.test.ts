import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";

// Opt-in disposable local database only. Temporary fixtures shadow all table
// names touched by the migration; shared dev/prod URLs are never accepted.
const rawUrl = process.env.CATALOG_MIGRATION_TEST_DATABASE_URL
  ?? (process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1"
    ? process.env.TEST_DATABASE_URL : undefined);
const target = rawUrl ? new URL(rawUrl) : null;
const enabled = !!target && ["localhost", "127.0.0.1", "::1"].includes(target.hostname) && /_test$/.test(target.pathname);
const migration = readFileSync(new URL("../../scripts/migrate-partner-owned-catalogs.sql", import.meta.url), "utf8");

describe.skipIf(!enabled)("partner catalog migration in disposable PostgreSQL", () => {
  it("preserves negotiated rates and never recreates removed selections, AFEs or approvals on rerun", async () => {
    const client = new pg.Client({ connectionString: rawUrl });
    try {
      await client.connect();
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE partners (id integer PRIMARY KEY);
        CREATE TEMP TABLE work_types (id serial PRIMARY KEY, partner_id integer, source_work_type_id integer,
          name text, category text, description text, estimated_duration text, estimated_price numeric,
          required_certifications text[], blocking_certifications text[], tax_treatment text);
        CREATE UNIQUE INDEX fixture_work_type_name ON work_types (partner_id, name);
        CREATE TEMP TABLE partner_vendor_relationships (partner_id integer, vendor_id integer, status text);
        CREATE TEMP TABLE vendor_work_types (vendor_id integer, work_type_id integer, unit_price numeric,
          unit text, currency text, notes text, price_authority_acknowledged_at timestamptz,
          last_price_change_reason text, tax_treatment text, UNIQUE(vendor_id, work_type_id));
        CREATE TEMP TABLE partner_work_type_afes (partner_id integer, work_type_id integer, afe text, UNIQUE(partner_id, work_type_id));
        CREATE TEMP TABLE partner_vendor_work_type_approvals (partner_id integer, vendor_id integer, work_type_id integer,
          approved_unit_price numeric, approved_unit text, approved_currency text, approved_at timestamptz,
          approved_by_user_id integer, tax_treatment text, UNIQUE(partner_id, vendor_id, work_type_id));
        CREATE TEMP TABLE partner_catalog_initializations (kind text, partner_id integer, vendor_id integer DEFAULT 0,
          source_work_type_id integer, work_type_id integer, initialized_at timestamptz DEFAULT now(),
          PRIMARY KEY(kind, partner_id, vendor_id, source_work_type_id));
        INSERT INTO partners VALUES (21), (22);
        INSERT INTO work_types (name, category) VALUES ('Service', 'Field');
        INSERT INTO work_types (partner_id, name, category) VALUES (21, 'Service', 'Owned');
        INSERT INTO partner_vendor_relationships VALUES (21, 10, 'approved'), (22, 10, 'approved');
        INSERT INTO vendor_work_types (vendor_id, work_type_id, unit_price, currency) VALUES (10, 1, 100, 'USD'), (10, 2, 175, 'USD');
        INSERT INTO partner_work_type_afes VALUES (21, 1, 'AFE-21');
        INSERT INTO partner_vendor_work_type_approvals (partner_id, vendor_id, work_type_id, approved_unit_price) VALUES (21, 10, 1, 100);
      `);
      await client.query(migration);
      const first = await client.query("SELECT unit_price FROM vendor_work_types WHERE vendor_id = 10 AND work_type_id = 2");
      expect(Number(first.rows[0].unit_price)).toBe(175);
      await client.query("DELETE FROM vendor_work_types WHERE vendor_id = 10 AND work_type_id = 2");
      await client.query("DELETE FROM partner_work_type_afes WHERE partner_id = 21 AND work_type_id = 2");
      await client.query("DELETE FROM partner_vendor_work_type_approvals WHERE partner_id = 21 AND vendor_id = 10 AND work_type_id = 2");
      await client.query(migration);
      for (const table of ["vendor_work_types", "partner_work_type_afes", "partner_vendor_work_type_approvals"]) {
        const result = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE work_type_id = 2`);
        expect(result.rows[0].count).toBe(0);
      }
      const legacy = await client.query("SELECT unit_price FROM vendor_work_types WHERE vendor_id = 10 AND work_type_id = 1");
      expect(Number(legacy.rows[0].unit_price)).toBe(100);
      await client.query("UPDATE work_types SET name = 'Renamed service' WHERE id = 2");
      await client.query("INSERT INTO work_types (partner_id, name, category) VALUES (21, 'Service', 'Independent')");
      await client.query(migration);
      const independent = await client.query("SELECT source_work_type_id FROM work_types WHERE partner_id = 21 AND name = 'Service'");
      expect(independent.rows[0].source_work_type_id).toBeNull();
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});
