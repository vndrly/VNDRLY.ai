import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {assertFreshLocalTestDatabaseEnvironment} from '../../../../scripts/fresh-test-database.mjs';
const isolated=process.env.VNDRLY_TEST_DB_MODE==='fresh-local'&&process.env.VNDRLY_ISOLATED_TEST_DB==='1';
if(isolated)assertFreshLocalTestDatabaseEnvironment(process.env);
describe.skipIf(!isolated)('Change Over production migration replay',()=>{
  it('applies original additive SQL to a brand-new local catalog and verifies a second no-op replay',async()=>{
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const {Client}=await import('pg');
    const {applyGateChangeOverMigration}=await import('../../../../scripts/gate-change-over-migration.mjs');
    const migration=await readFile(new URL('../../../../lib/db/drizzle/gate_change_over.sql',import.meta.url),'utf8');
    const target=new URL(process.env.DATABASE_URL!),maintenance=new URL(target);
    maintenance.pathname='/postgres';
    const database=`vndrly_${randomUUID().replaceAll('-','')}_test`;
    const administrator=new Client({connectionString:maintenance.href});
    await administrator.connect();
    try { await administrator.query(`CREATE DATABASE "${database}"`); } finally { await administrator.end(); }
    target.pathname=`/${database}`;
    const fresh=new Client({connectionString:target.href});
    await fresh.connect();
    try {
      expect((await fresh.query('SELECT current_database() AS name,host(inet_server_addr()) AS address')).rows[0]).toEqual({name:database,address:'127.0.0.1'});
      // Only prerequisite relation shapes, all in this new empty database.
      await fresh.query(`CREATE TABLE site_locations(id integer PRIMARY KEY);
        CREATE TABLE users(id integer PRIMARY KEY);
        CREATE TABLE site_visits(site_location_id integer,check_in_time timestamptz);
        CREATE TABLE ticket_check_ins(ticket_id integer,check_out_at timestamptz,check_in_at timestamptz,gate_station_id uuid);
        CREATE TABLE ticket_status_history(ticket_id integer,to_status text,created_at timestamptz);
        CREATE TABLE work_hub_task_events(task_id uuid,event_type text,created_at timestamptz);
        CREATE TABLE assistant_action_audit(vendor_id integer,partner_id integer,target_type text,target_id text,id integer);`);
      expect(await applyGateChangeOverMigration(fresh,migration)).toEqual({applied:true,verified:true});
      expect(await applyGateChangeOverMigration(fresh,migration)).toEqual({applied:false,verified:true});
      await fresh.query('INSERT INTO site_locations(id) VALUES(1)');
      expect((await fresh.query('SELECT site_id,name FROM gate_stations')).rows).toEqual([{site_id:1,name:'Main gate'}]);
    }finally{await fresh.end();}
    // No database reset/drop: the uniquely named synthetic database remains for inspection.
  });
  it('verifies actual catalog and replays without conflicting with an active Gate writer',async()=>{
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const {pool}=await import('@workspace/db');
    const {applyGateChangeOverMigration,readGateMigrationCatalog,gateMigrationCatalogProblems}=await import('../../../../scripts/gate-change-over-migration.mjs');
    const migration=await readFile(new URL('../../../../lib/db/drizzle/gate_change_over.sql',import.meta.url),'utf8');
    const writer=await pool.connect(),reader=await pool.connect();
    try {
      const catalog=await readGateMigrationCatalog(reader);
      expect(gateMigrationCatalogProblems(catalog,migration)).toEqual([]);
      // Existing migrator's unconditional ALTER TABLE ENABLE RLS would block
      // behind this ordinary writer lock; catalog-only replay needs no DDL lock.
      await writer.query('BEGIN');
      await writer.query('LOCK TABLE gate_stations IN ROW EXCLUSIVE MODE');
      await reader.query("SET statement_timeout='2s'");
      expect(await applyGateChangeOverMigration(reader,migration)).toEqual({applied:false,verified:true});
      const changed=structuredClone(catalog);changed.functions[0].body='BEGIN RETURN NEW; END;';
      expect(gateMigrationCatalogProblems(changed,migration)).toContain(`function:${changed.functions[0].name}`);
      const disabled=structuredClone(catalog);disabled.triggers[0].enabled='D';
      expect(gateMigrationCatalogProblems(disabled,migration)).toContain(`trigger:${disabled.triggers[0].name}`);
    }finally{await writer.query('ROLLBACK');await reader.query('RESET statement_timeout');writer.release();reader.release();}
  });
});
