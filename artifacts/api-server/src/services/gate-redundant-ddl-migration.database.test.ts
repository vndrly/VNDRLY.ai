import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Client} from 'pg';
import {describe,it,expect} from 'vitest';
import {assertFreshLocalTestDatabaseEnvironment} from '../../../../scripts/fresh-test-database.mjs';
import {applyGateOperationsMigration,gateOperationsContract} from '../../../../scripts/gate-operations-command-center-migration.mjs';
import {migrateGateHistoryAssociations,gateHistoryAssociationContract} from '../../../../scripts/gate-history-association-migration.mjs';
import {readAdditiveCatalog,additiveCatalogProblems} from '../../../../scripts/gate-additive-catalog.mjs';
const isolated=process.env.VNDRLY_TEST_DB_MODE==='fresh-local'&&process.env.VNDRLY_ISOLATED_TEST_DB==='1';
const sql=await readFile(new URL('../../../../lib/db/drizzle/gate_operations_command_center.sql',import.meta.url),'utf8');
async function fixture(){
 assertFreshLocalTestDatabaseEnvironment(process.env);
 const target=new URL(process.env.DATABASE_URL!),maintenance=new URL(target);maintenance.pathname='/postgres';
 const name=`vndrly_${randomUUID().replaceAll('-','')}_test`,admin=new Client({connectionString:maintenance.href});await admin.connect();try{await admin.query(`CREATE DATABASE "${name}"`);}finally{await admin.end();}
 target.pathname=`/${name}`;const client=new Client({connectionString:target.href});await client.connect();
 await client.query(`CREATE TABLE users(id integer PRIMARY KEY);CREATE TABLE site_locations(id integer PRIMARY KEY);CREATE TABLE gate_stations(id uuid PRIMARY KEY);CREATE TABLE gate_shifts(id uuid PRIMARY KEY,station_id uuid,operator_id integer,started_at timestamptz DEFAULT now(),ended_at timestamptz);CREATE TABLE work_hub_shifts(id uuid PRIMARY KEY,starts_at timestamptz,ends_at timestamptz);CREATE TABLE workforce_coverage_records(id uuid PRIMARY KEY);CREATE TABLE site_visits(id integer PRIMARY KEY);CREATE TABLE ticket_check_ins(id integer PRIMARY KEY);INSERT INTO site_visits VALUES(1);INSERT INTO ticket_check_ins VALUES(1);`);
 return {client,url:target.href};
}
async function history(client:Client){await client.query('BEGIN');try{const result=await migrateGateHistoryAssociations(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
describe.skipIf(!isolated)('Gate downstream catalog replay under real PostgreSQL writers',()=>{
 it('runs the original additive operations/history paths then replays without changing saved history',async()=>{
  const {client}=await fixture();try{
   expect(await applyGateOperationsMigration(client,sql)).toEqual({applied:true,verified:true});expect(await history(client)).toEqual({applied:true,verified:true});
   expect(await applyGateOperationsMigration(client,sql)).toEqual({applied:false,verified:true});expect(await history(client)).toEqual({applied:false,verified:true});
   expect((await client.query('SELECT id,gate_association_provenance FROM site_visits')).rows).toEqual([{id:1,gate_association_provenance:null}]);
   expect(additiveCatalogProblems(await readAdditiveCatalog(client,gateOperationsContract(sql)),gateOperationsContract(sql))).toEqual([]);
  }finally{await client.end();}
 });
 it('skips all completed DDL while actual live-table writer locks are held',async()=>{
  const {client,url}=await fixture();const writer=new Client({connectionString:url});await writer.connect();try{
   await applyGateOperationsMigration(client,sql);await history(client);await writer.query('BEGIN');await writer.query('LOCK TABLE site_visits,ticket_check_ins,work_hub_shifts,gate_work_sessions,gate_duty_sessions IN ROW EXCLUSIVE MODE');await client.query("SET statement_timeout='1s'");
   expect(await applyGateOperationsMigration(client,sql)).toEqual({applied:false,verified:true});expect(await history(client)).toEqual({applied:false,verified:true});
  }finally{await writer.query('ROLLBACK');await writer.end();await client.end();}
 });
 it('adds only absent history columns, preserving an already correct association',async()=>{
  const {client}=await fixture();try{
   await client.query('ALTER TABLE site_visits ADD COLUMN gate_station_id uuid REFERENCES gate_stations(id)');const gate=randomUUID();await client.query('INSERT INTO gate_stations VALUES($1)',[gate]);await client.query('UPDATE site_visits SET gate_station_id=$1 WHERE id=1',[gate]);
   expect(await history(client)).toEqual({applied:true,verified:true});expect((await client.query('SELECT gate_station_id FROM site_visits WHERE id=1')).rows[0].gate_station_id).toBe(gate);
   expect(additiveCatalogProblems(await readAdditiveCatalog(client,gateHistoryAssociationContract),gateHistoryAssociationContract)).toEqual([]);
  }finally{await client.end();}
 });
 it('backfills a newly pending legacy duty without replaying DDL and is race/replay safe',async()=>{
  const {client,url}=await fixture(),writer=new Client({connectionString:url}),second=new Client({connectionString:url});await writer.connect();await second.connect();try{
   await applyGateOperationsMigration(client,sql);const gate=randomUUID(),shift=randomUUID();await client.query('INSERT INTO users VALUES(1)');await client.query('INSERT INTO gate_stations VALUES($1)',[gate]);await client.query('INSERT INTO gate_shifts(id,station_id,operator_id) VALUES($1,$2,1)',[shift,gate]);
   await writer.query('BEGIN');await writer.query('LOCK TABLE work_hub_shifts IN ROW EXCLUSIVE MODE');
   const results=await Promise.all([applyGateOperationsMigration(client,sql),applyGateOperationsMigration(second,sql)]);expect(results.every(r=>r.verified&&!r.applied)).toBe(true);
   expect((await client.query('SELECT station_id,user_id,source_legacy_shift_id,ended_at FROM gate_duty_sessions')).rows).toEqual([{station_id:gate,user_id:1,source_legacy_shift_id:shift,ended_at:null}]);expect(await applyGateOperationsMigration(client,sql)).toEqual({applied:false,verified:true});
  }finally{await writer.query('ROLLBACK');await writer.end();await second.end();await client.end();}
 });
 it('does not declare a same-name wrong index or incompatible column contract complete',async()=>{
  const {client}=await fixture();try{
   await client.query('CREATE INDEX work_hub_shifts_gate_time_idx ON work_hub_shifts(ends_at)');await expect(applyGateOperationsMigration(client,sql)).rejects.toThrow(/postflight.*index:work_hub_shifts_gate_time_idx/);
   await client.query('ALTER TABLE workforce_coverage_records ALTER COLUMN actual_count SET DEFAULT 1');await expect(applyGateOperationsMigration(client,sql)).rejects.toThrow(/postflight.*column:workforce_coverage_records.actual_count/);
   await history(client);await client.query('ALTER TABLE site_visits ALTER COLUMN gate_association_provenance SET DEFAULT \'{}\'::jsonb');await expect(history(client)).rejects.toThrow(/catalog mismatch/);
  }finally{await client.end();}
 });
 it('checks nullable/default/FK/PK/unique/index validity and RLS, and pins the unchanged SQL source',async()=>{
  const {client}=await fixture();try{
   await applyGateOperationsMigration(client,sql);const contract=gateOperationsContract(sql),catalog=await readAdditiveCatalog(client,contract);
   for(const mutate of [(c:any)=>{c.columns.find((x:any)=>x.table_name==='workforce_coverage_records'&&x.name==='coverage_kind').default_value="'public.general'::text";},(c:any)=>{c.columns.find((x:any)=>x.table_name==='gate_work_sessions'&&x.name==='source').not_null=false;},(c:any)=>{const fk=c.constraints.find((x:any)=>x.type==='f');fk.delete_action=fk.delete_action==='c'?'a':'c';},(c:any)=>{c.constraints.find((x:any)=>x.type==='p'&&x.table_name==='gate_work_sessions').index_valid=false;},(c:any)=>{c.constraints.find((x:any)=>x.type==='u').index_ready=false;},(c:any)=>{c.indexes[0].ready=false;},(c:any)=>{c.indexes[0].valid=false;},(c:any)=>{c.indexes[0].predicate='false';},(c:any)=>{c.tables.find((x:any)=>x.name==='gate_work_sessions').rls=false;}]){const changed=structuredClone(catalog);mutate(changed);expect(additiveCatalogProblems(changed,contract).length,mutate.toString()).toBeGreaterThan(0);}
   expect(()=>gateOperationsContract(sql+'\nCREATE INDEX unexpected ON gate_work_sessions(source);')).toThrow(/SQL changed/);
  }finally{await client.end();}
 });
});
