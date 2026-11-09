import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {applyGateChangeOverMigration,gateMigrationCatalogProblems,assertAdditiveGateMigration} from '../gate-change-over-migration.mjs';
const migration=await readFile(new URL('../../lib/db/drizzle/gate_change_over.sql',import.meta.url),'utf8');
// Catalog-only snapshot from the fresh local PostgreSQL rehearsal; contains no rows/user data.
const current=JSON.parse(await readFile(new URL('./fixtures/gate-change-over-catalog.json',import.meta.url),'utf8'));
const keys=['tables','columns','constraints','indexes','triggers','functions'];
function client(before=current,after=current){let reads=0;const calls=[];return {calls,query:async(sql)=>{calls.push(sql);if(sql.startsWith('SELECT')){const phase=reads<6?before:after,key=keys[reads++%6];return {rows:phase[key]};}return {rows:[]};}};}
test('verified current catalog skips all DDL and lock requests',async()=>{assert.deepEqual(gateMigrationCatalogProblems(current,migration),[]);const db=client();assert.deepEqual(await applyGateChangeOverMigration(db,migration),{applied:false,verified:true});assert.equal(db.calls.length,6);assert.ok(db.calls.every(sql=>sql.startsWith('SELECT')));});
for(const [name,change] of Object.entries({
 'missing column':c=>c.columns.splice(0,1),
 'wrong default':c=>c.columns.find(r=>r.name==='id').default_value='NULL',
 'missing primary key':c=>c.constraints=c.constraints.filter(r=>r.type!=='p'),
 'unvalidated foreign key':c=>c.constraints.find(r=>r.type==='f').validated=false,
 'invalid index':c=>c.indexes[0].valid=false,
 'unready index':c=>c.indexes[0].ready=false,
 'wrong index columns':c=>c.indexes[0].columns=['id'],
 'disabled RLS':c=>c.tables[0].rls=false,
 'disabled trigger':c=>c.triggers[0].enabled='D',
 'wrong trigger function':c=>c.triggers[0].function_name='wrong',
 'changed function body':c=>c.functions[0].body='BEGIN RETURN NEW; END;',
 'security definer':c=>c.functions[0].security_definer=true,
}))test(`${name} cannot be mistaken for a complete migration`,async()=>{const broken=structuredClone(current);change(broken);assert.ok(gateMigrationCatalogProblems(broken,migration).length);const db=client(broken);assert.deepEqual(await applyGateChangeOverMigration(db,migration),{applied:true,verified:true});assert.ok(db.calls.includes("SET lock_timeout='5s'"));assert.ok(db.calls.includes(migration));assert.equal(db.calls.filter(sql=>sql.startsWith('SELECT')).length,12);});
test('postflight rejects unresolved catalog mismatches',async()=>{const broken=structuredClone(current);broken.triggers[0].enabled='D';await assert.rejects(applyGateChangeOverMigration(client(broken,broken),migration),/postflight failed/);});
test('additive and exact-source guards remain mandatory',()=>{assert.throws(()=>assertAdditiveGateMigration('DROP TABLE gate_shifts;'),/Non-additive/);assert.throws(()=>assertAdditiveGateMigration(migration+'\nSELECT 1;'),/SQL changed/);});
test('failed migration rolls back rather than leaving locks open',async()=>{const broken=structuredClone(current);broken.indexes=[];const db=client(broken),query=db.query;db.query=async sql=>{if(sql===migration)throw Error('lock timeout');return query(sql)};await assert.rejects(applyGateChangeOverMigration(db,migration),/lock timeout/);assert.ok(db.calls.includes('ROLLBACK'));});
