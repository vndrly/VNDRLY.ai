/** Import a verified synthetic-only manifest into the empty demo database. */
import './load-env-local.mjs';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const manifest=JSON.parse(await readFile(new URL('../.local/prairie-demo-isolation-export.json',import.meta.url),'utf8'));
if(manifest.violations.length)throw Error('Unresolved manifest references');
if(createHash('sha256').update(JSON.stringify(manifest.tables)).digest('hex')!==manifest.sha256)throw Error('Manifest checksum mismatch');
const source=new Client({connectionString:process.env.DATABASE_URL});
const url=new URL(process.env.DATABASE_URL);url.pathname='/vndrly_prairie_demo';
const dest=new Client({connectionString:url.toString()});
const q=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Unsafe identifier');return `"${s}"`;};
await Promise.all([source.connect(),dest.connect()]);
try{
 if((await dest.query('select current_database() n')).rows[0].n!=='vndrly_prairie_demo')throw Error('Wrong destination');
 const destinationColumns=(await dest.query("select table_name,column_name from information_schema.columns where table_schema='public'")).rows;
 const known=new Set(destinationColumns.map(r=>`${r.table_name}.${r.column_name}`));
 // Preserve additive production columns absent from this checkout's schema.
 for(const [table,rows] of Object.entries(manifest.tables))for(const field of Object.keys(rows[0]))if(!known.has(`${table}.${field}`)){
  const meta=(await source.query(`select format_type(a.atttypid,a.atttypmod) type from pg_attribute a join pg_class t on t.oid=a.attrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and t.relname=$1 and a.attname=$2 and not a.attisdropped`,[table,field])).rows[0];
  if(!meta||!/^([a-z ]+)(\([0-9,]+\))?(\[\])?$/.test(meta.type))throw Error(`Unreviewed destination column type: ${table}.${field}`);
  await dest.query(`ALTER TABLE ${q(table)} ADD COLUMN IF NOT EXISTS ${q(field)} ${meta.type}`);known.add(`${table}.${field}`);
 }
 await dest.query('BEGIN');
 for(const table of Object.keys(manifest.tables))if(Number((await dest.query(`select count(*) n from ${q(table)}`)).rows[0].n))throw Error(`Destination table not empty: ${table}`);
 // Active memberships and their users form a legitimate cycle. Defer the
 // empty destination's FK checks only for the import transaction; COMMIT
 // validates all links together. No production constraints are changed.
 const constraints=(await dest.query("select t.relname table_name,con.conname from pg_constraint con join pg_class t on t.oid=con.conrelid join pg_namespace n on n.oid=t.relnamespace where con.contype='f' and n.nspname='public'")).rows;
 for(const con of constraints)await dest.query(`ALTER TABLE ${q(con.table_name)} ALTER CONSTRAINT ${q(con.conname)} DEFERRABLE INITIALLY IMMEDIATE`);
 await dest.query('SET CONSTRAINTS ALL DEFERRED');
 let pending=Object.entries(manifest.tables),imported=0;
 while(pending.length){const next=[];let progress=0;
  for(const [table,rows] of pending){await dest.query('SAVEPOINT demo_table');
   try{
    const fields=Object.keys(rows[0]);await dest.query(`INSERT INTO ${q(table)} (${fields.map(q).join(',')}) SELECT ${fields.map(q).join(',')} FROM jsonb_populate_recordset(NULL::${q(table)},$1::jsonb)`,[JSON.stringify(rows)]);
    progress++;imported+=rows.length;await dest.query('RELEASE SAVEPOINT demo_table');
   }catch(error){await dest.query('ROLLBACK TO SAVEPOINT demo_table');if(error.code!=='23503')throw error;next.push([table,rows]);}
  }
  if(!progress)throw Error(`Unresolved import dependency: ${next.map(([t])=>t).join(', ')}`);pending=next;
 }
 const verification=[];
 for(const [table,rows] of Object.entries(manifest.tables)){
  const actual=(await dest.query(`select * from ${q(table)}`)).rows;
  if(actual.length!==rows.length)throw Error(`Count mismatch: ${table}`);
  const canonical=row=>JSON.stringify(Object.fromEntries(Object.keys(rows[0]).sort().map(k=>[k,row[k]])));
  if(JSON.stringify(actual.map(canonical).sort())!==JSON.stringify(rows.map(canonical).sort()))throw Error(`Content mismatch: ${table}`);
  verification.push({table,rows:actual.length,contentsMatch:true});
 }
 // Serial sequences must continue after the preserved IDs.
 const seqs=(await dest.query(`select t.relname table_name,a.attname column_name,pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(t.relname),a.attname) sequence from pg_attribute a join pg_class t on t.oid=a.attrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and t.relkind='r' and a.attnum>0 and not a.attisdropped`)).rows.filter(r=>r.sequence);
 for(const seq of seqs)await dest.query(`select setval($1::regclass,coalesce((select max(${q(seq.column_name)}) from ${q(seq.table_name)}),1),exists(select 1 from ${q(seq.table_name)}))`,[seq.sequence]);
 await dest.query('COMMIT');
 await writeFile(new URL('../.local/prairie-demo-isolation-import.json',import.meta.url),JSON.stringify({verifiedAt:new Date().toISOString(),imported,verification},null,2));
 console.log(JSON.stringify({imported,tables:verification.length,contentsMatch:true,productionModified:false}));
}catch(error){await dest.query('ROLLBACK');throw error;}
finally{await Promise.all([source.end(),dest.end()]);}
