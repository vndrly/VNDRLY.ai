/** Copy newly discovered synthetic history only; never replace existing rows. */
import './load-env-local.mjs';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const manifest=JSON.parse(await readFile('.local/prairie-demo-isolation-export.json','utf8'));
if(manifest.violations.length)throw Error('Manifest cross-reference failure');
const url=new URL(process.env.DATABASE_URL);url.pathname='/vndrly_prairie_demo';
const c=new Client({connectionString:url.toString()});await c.connect();
const q=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Unsafe identifier');return `"${s}"`;};
try{
 if((await c.query('select current_database() n')).rows[0].n!=='vndrly_prairie_demo')throw Error('Wrong database');
 await c.query('BEGIN');await c.query('SET CONSTRAINTS ALL DEFERRED');const inserted={};
 for(const [table,rows] of Object.entries(manifest.tables)){
  const fields=Object.keys(rows[0]);const keys=manifest.keys[table];
  const result=await c.query(`INSERT INTO ${q(table)} (${fields.map(q).join(',')}) SELECT ${fields.map(k=>`incoming.${q(k)}`).join(',')} FROM jsonb_populate_recordset(NULL::${q(table)},$1::jsonb) incoming WHERE NOT EXISTS (SELECT 1 FROM ${q(table)} existing WHERE ${keys.map(k=>`existing.${q(k)} IS NOT DISTINCT FROM incoming.${q(k)}`).join(' AND ')}) ON CONFLICT DO NOTHING`,[JSON.stringify(rows)]);
  if(result.rowCount){inserted[table]=result.rowCount;
   if(fields.includes('id')){const seq=(await c.query('select pg_get_serial_sequence($1,$2) n',[table,'id'])).rows[0].n;if(seq)await c.query(`select setval($1::regclass,(select max(id) from ${q(table)}),true)`,[seq]);}
  }
 }
 await c.query('COMMIT');
 await writeFile('.local/prairie-demo-history-delta.json',JSON.stringify({copiedAt:new Date().toISOString(),inserted,replacedExisting:false,productionModified:false},null,2));console.log(JSON.stringify({inserted,replacedExisting:false,productionModified:false}));
}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
