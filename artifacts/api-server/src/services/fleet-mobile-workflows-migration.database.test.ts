import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";

const migration = fileURLToPath(new URL("../../scripts/migrate-fleet-mobile-workflows.ts", import.meta.url));
const tables = [
  "fleet_yards", "fleet_person_capabilities", "fleet_yard_orders",
  "fleet_yard_order_assignments", "fleet_yard_order_events",
  "fleet_asset_custody", "fleet_asset_custody_events",
];

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")("Fleet mobile additive migration", () => {
  it("creates the seven scoped tables once and retains Yard Order and custody history on replay", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const schema = `fleet_migration_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const options = `-c search_path=${schema},public`;
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options });
      await client.connect();
      try {
        const inspect = async () => (await admin.query(
          "SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename", [schema],
        )).rows.map((row) => row.tablename);
        const indexes = async () => (await admin.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname", [schema],
        )).rows.map((row) => row.indexname);
        const run = () => {
          const result = spawnSync(process.execPath, ["--import", "tsx", migration], {
            env: { ...process.env, PGOPTIONS: options }, encoding: "utf8", timeout: 30000, windowsHide: true,
          });
          expect(result.error).toBeUndefined();
          expect(result.status, result.stderr).toBe(0);
        };

        expect(await inspect()).toEqual([]);
        run();
        expect(await inspect()).toEqual(tables.slice().sort());
        const firstIndexes = await indexes();
        expect(firstIndexes).toContain("fleet_person_capabilities_company_user_unique");
        expect(firstIndexes).toContain("fleet_asset_custody_company_asset_unique");
        expect(firstIndexes).toContain("fleet_yard_order_events_operation_unique");

        const company = (await client.query(
          "INSERT INTO public.vendors(name,contact_name,contact_email) VALUES($1,$2,$3) RETURNING id",
          [`Fleet ${randomUUID()}`, "Synthetic", `fleet-${randomUUID()}@example.invalid`],
        )).rows[0].id;
        const user = (await client.query(
          "INSERT INTO public.users(username,password_hash,role,display_name) VALUES($1,'unused','vendor','Synthetic') RETURNING id",
          [`fleet-${randomUUID()}@example.invalid`],
        )).rows[0].id;
        await client.query("INSERT INTO public.user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'member')", [user, company]);
        const yard = (await client.query(
          "INSERT INTO fleet_yards(company_id,name,time_zone,is_home_base) VALUES($1,'Home','America/Chicago',true) RETURNING id",
          [company],
        )).rows[0].id;
        const order = (await client.query(
          "INSERT INTO fleet_yard_orders(company_id,yard_id,requested_by_user_id) VALUES($1,$2,$3) RETURNING id",
          [company, yard, user],
        )).rows[0].id;
        const orderOperation = randomUUID();
        await client.query(
          "INSERT INTO fleet_yard_order_events(company_id,order_id,operation_id,actor_user_id,event_type,order_version) VALUES($1,$2,$3,$4,'requested',1)",
          [company, order, orderOperation, user],
        );
        const asset = (await client.query(
          "INSERT INTO public.assets(name,category,legal_owner_name,responsible_org_type,responsible_org_id) VALUES('Truck','truck','Synthetic','vendor',$1) RETURNING id",
          [company],
        )).rows[0].id;
        await client.query("INSERT INTO fleet_asset_custody(company_id,asset_id,state,method,observed_by_user_id) VALUES($1,$2,'at_yard','manual',$3)", [company, asset, user]);
        const custodyOperation = randomUUID();
        await client.query(
          "INSERT INTO fleet_asset_custody_events(company_id,asset_id,operation_id,state,method,observed_by_user_id) VALUES($1,$2,$3,'at_yard','manual',$4)",
          [company, asset, custodyOperation, user],
        );
        await client.query("INSERT INTO fleet_person_capabilities(company_id,user_id,capabilities) VALUES($1,$2,ARRAY['driver','yard']::text[])", [company, user]);
        await expect(client.query("INSERT INTO fleet_person_capabilities(company_id,user_id) VALUES($1,$2)", [company, user])).rejects.toMatchObject({ code: "23505" });
        await expect(client.query("UPDATE fleet_yard_order_events SET event_type='changed' WHERE operation_id=$1", [orderOperation])).rejects.toMatchObject({ code: "P0001" });
        await expect(client.query("UPDATE fleet_asset_custody_events SET state='returned' WHERE operation_id=$1", [custodyOperation])).rejects.toMatchObject({ code: "P0001" });
        const otherCompany = (await client.query(
          "INSERT INTO public.vendors(name,contact_name,contact_email) VALUES($1,$2,$3) RETURNING id",
          [`Other ${randomUUID()}`, "Synthetic", `other-${randomUUID()}@example.invalid`],
        )).rows[0].id;
        await client.query("INSERT INTO public.user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'member')", [user, otherCompany]);
        await expect(client.query("INSERT INTO fleet_yard_orders(company_id,yard_id,requested_by_user_id) VALUES($1,$2,$3)", [otherCompany, yard, user])).rejects.toMatchObject({ code: "23503" });
        await expect(client.query("INSERT INTO fleet_asset_custody(company_id,asset_id,state,method,observed_by_user_id) VALUES($1,$2,'at_yard','manual',$3)", [otherCompany, asset, user])).rejects.toMatchObject({ code: "P0001" });
        const before = (await client.query(
          "SELECT (SELECT to_jsonb(e) FROM fleet_yard_order_events e WHERE operation_id=$1) AS order_event, (SELECT to_jsonb(e) FROM fleet_asset_custody_events e WHERE operation_id=$2) AS custody_event",
          [orderOperation, custodyOperation],
        )).rows[0];
        run();
        expect(await inspect()).toEqual(tables.slice().sort());
        expect(await indexes()).toEqual(firstIndexes);
        expect((await client.query(
          "SELECT (SELECT to_jsonb(e) FROM fleet_yard_order_events e WHERE operation_id=$1) AS order_event, (SELECT to_jsonb(e) FROM fleet_asset_custody_events e WHERE operation_id=$2) AS custody_event",
          [orderOperation, custodyOperation],
        )).rows[0]).toEqual(before);
        const source = readFileSync(migration, "utf8");
        expect(source).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|pg_restore|pg_dump)\b/i);
      } finally {
        await client.end();
      }
    } finally {
      await admin.end();
    }
  });
});
