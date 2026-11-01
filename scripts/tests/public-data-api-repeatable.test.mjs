import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { provisionFreshLocalTestDatabase, resolveFreshLocalTestDatabaseTarget } from '../fresh-test-database.mjs';
const {Client}=createRequire(new URL('../../lib/db/package.json',import.meta.url))('pg');
test('repeated hardening preserves security while a live reader holds an already hardened table', {skip:process.env.VNDRLY_TEST_DB_MODE!=='fresh-local'}, async()=>{
  const target=resolveFreshLocalTestDatabaseTarget(process.env);
  await provisionFreshLocalTestDatabase(target,url=>new Client({connectionString:url}),async()=>({hasDataLoss:false,warnings:[],statementsToExecute:['CREATE TABLE public.noop_lock_probe (id integer)']}));
  const admin=new Client({connectionString:target.testUrl}), reader=new Client({connectionString:target.testUrl});
  try{
    await admin.connect();
    await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$; INSERT INTO public.noop_lock_probe VALUES(7)`);
    const sql=readFileSync(new URL('../../artifacts/api-server/scripts/harden-public-data-api.sql',import.meta.url),'utf8');
    await admin.query(sql);
    await reader.connect();await reader.query('BEGIN');await reader.query('SELECT * FROM public.noop_lock_probe');
    await admin.query("SET lock_timeout='300ms'");
    await assert.rejects(admin.query(sql.replace(' AND NOT item.relrowsecurity THEN',' THEN')),error=>error.code==='55P03');
    await admin.query(sql);
    const result=await admin.query("SELECT relrowsecurity,has_schema_privilege('anon','public','USAGE') AS anon_schema,has_table_privilege('anon','public.noop_lock_probe','SELECT') AS anon_read FROM pg_class WHERE oid='public.noop_lock_probe'::regclass");
    assert.deepEqual(result.rows,[{relrowsecurity:true,anon_schema:false,anon_read:false}]);
    assert.deepEqual((await reader.query('SELECT * FROM public.noop_lock_probe')).rows,[{id:7}]);
  }finally{await reader.query('ROLLBACK').catch(()=>{});await reader.end();await admin.end();}
});
