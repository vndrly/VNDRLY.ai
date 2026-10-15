/** Exact-manifest cleanup. --apply additionally requires recorded human approval.
 * Defaults to review only. No cascades, resets, or constraint disabling.
 */
import './load-env-local.mjs';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile('.local/prairie-demo-production-removal-manifest.json','utf8'));
const sql=await readFile('.local/prairie-demo-production-removal.sql','utf8');
if(createHash('sha256').update(sql).digest('hex')!==manifest.sqlSha256)throw Error('Reviewed command checksum changed');
if(!process.argv.includes('--apply')){console.log(JSON.stringify({reviewOnly:true,total:Object.values(manifest.counts).reduce((a,b)=>a+b,0),tables:manifest.order.length,approved:manifest.approved}));}
else{
 if(manifest.approved!==true||!manifest.approvalMessage)throw Error('Explicit human approval of this exact removal manifest is required');
 const snapshot=JSON.parse(await readFile('.local/prairie-demo-isolation-export.json','utf8'));
 const accounts=JSON.parse(await readFile('.local/prairie-demo-accounts.json','utf8'));
 const report=JSON.parse(await readFile('.local/prairie-demo-report.json','utf8'));
 const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
 const q=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Unsafe identifier');return `"${s}"`;};
 const selection=(table)=>{const params=[];const condition=manifest.tables[table].map(row=>'('+manifest.keys[table].map(k=>{params.push(row[k]);return `${q(k)} IS NOT DISTINCT FROM $${params.length}`;}).join(' AND ')+')').join(' OR ');return {condition,params};};
 const access=JSON.parse(await readFile('.local/prairie-demo-database-access.json','utf8'));
 const demo=new Client({connectionString:access.url});await demo.connect();
 try{
  if((await demo.query('SELECT current_database() n')).rows[0].n!=='vndrly_prairie_demo')throw Error('Isolated recovery copy identity failed');
  for(const table of manifest.order){const {condition,params}=selection(table);const count=Number((await demo.query(`SELECT count(*) n FROM ${q(table)} WHERE ${condition}`,params)).rows[0].n);if(count!==manifest.counts[table])throw Error(`Isolated copy missing reviewed rows: ${table}`);}
 }finally{await demo.end();}
 const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
 const actual={},untouchedCounts={},deleted={};
 try{
  if((await c.query('select current_database() n')).rows[0].n==='vndrly_prairie_demo')throw Error('Wrong cleanup database');
  await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await c.query("SET LOCAL lock_timeout='10s'");
  // Lock every reviewed row before touching it. FK inserts into these parents
  // cannot race the subsequent absence checks and accidentally cascade.
  for(const table of Object.keys(manifest.tables).sort()){
   const {condition,params}=selection(table);
   actual[table]=(await c.query(`SELECT * FROM ${q(table)} WHERE ${condition} FOR UPDATE`,params)).rows;
   if(actual[table].length!==manifest.counts[table])throw Error(`Changed reviewed count: ${table}`);
   untouchedCounts[table]=Number((await c.query(`SELECT count(*) n FROM ${q(table)} WHERE NOT (${condition})`,params)).rows[0].n);
  }
  const marker=`Synthetic VNDRLY demo (${report.version}). No real work, person, credential, or payment is represented.`;
  for(const row of [...actual.partners,...actual.vendors])if(row.blurb!==marker)throw Error('Synthetic root marker changed');
  for(const row of actual.users){const identity=accounts.accounts.find(a=>a.id===row.id&&a.username===row.username);const saved=snapshot.tables.users.find(u=>u.id===row.id);if(!identity||row.password_hash!==saved?.password_hash)throw Error('Synthetic identity or password changed');}
  const fks=(await c.query(`SELECT child.relname child,ca.attname child_column,parent.relname parent,pa.attname parent_column FROM pg_constraint con JOIN pg_class child ON child.oid=con.conrelid JOIN pg_namespace n ON n.oid=child.relnamespace JOIN pg_class parent ON parent.oid=con.confrelid JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=con.conkey[1] JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=con.confkey[1] WHERE con.contype='f' AND n.nspname='public' AND cardinality(con.conkey)=1`)).rows;
  // Recovery snapshot contains only the locked fictional rows, never real data.
  await writeFile('.local/prairie-demo-production-cleanup-recovery.json',JSON.stringify({capturedAt:new Date().toISOString(),tables:actual},null,2),{mode:0o600});
  for(const link of manifest.nullableCycleBreaks){const {condition,params}=selection(link.child);await c.query(`UPDATE ${q(link.child)} SET ${q(link.column_name)}=NULL WHERE ${condition}`,params);}
  for(const table of manifest.order){
   for(const fk of fks.filter(f=>f.parent===table)){
    const values=actual[table].map(row=>String(row[fk.parent_column]));
    const children=(await c.query(`SELECT * FROM ${q(fk.child)} WHERE ${q(fk.child_column)}::text=ANY($1::text[])`,[values])).rows;
    if(fk.child!==table&&children.length)throw Error(`Remaining reference would cascade or mutate an unreviewed row: ${fk.child}`);
    if(fk.child===table&&children.some(row=>!actual[table].some(saved=>manifest.keys[table].every(k=>saved[k]===row[k]))))throw Error('Unreviewed self-reference');
   }
   const {condition,params}=selection(table);const result=await c.query(`DELETE FROM ${q(table)} WHERE ${condition}`,params);
   if(result.rowCount!==manifest.counts[table])throw Error(`Deletion count mismatch: ${table}`);deleted[table]=result.rowCount;
  }
  for(const table of manifest.order){const count=Number((await c.query(`SELECT count(*) n FROM ${q(table)}`)).rows[0].n);if(count!==untouchedCounts[table])throw Error(`Unreviewed row count changed: ${table}`);}
  await c.query('COMMIT');
  const evidence={completedAt:new Date().toISOString(),sqlSha256:manifest.sqlSha256,deleted,total:Object.values(deleted).reduce((a,b)=>a+b,0),unreviewedRowsRemoved:0};
  await writeFile('.local/prairie-demo-production-cleanup-result.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }catch(error){await c.query('ROLLBACK');throw error;}finally{await c.end();}
}
