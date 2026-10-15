/** Read-only synthetic dependency export. No production mutation. Private output only. */
import './load-env-local.mjs';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const report=JSON.parse(await readFile(new URL('../.local/prairie-demo-report.json',import.meta.url),'utf8'));
const accounts=JSON.parse(await readFile(new URL('../.local/prairie-demo-accounts.json',import.meta.url),'utf8'));
const ids=report.ids, marker=`Synthetic VNDRLY demo (${report.version}). No real work, person, credential, or payment is represented.`;
const c=new Client({connectionString:process.env.DATABASE_URL});
const q=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Unsafe identifier');return `"${s}"`;};
await c.connect();
try{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const columns=(await c.query("select table_name,column_name from information_schema.columns where table_schema='public' order by table_name,ordinal_position")).rows;
 const tables=new Map();for(const r of columns){if(!tables.has(r.table_name))tables.set(r.table_name,[]);tables.get(r.table_name).push(r.column_name);}
 const pk=(await c.query(`select tc.table_name,kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name and tc.table_schema=kcu.table_schema where tc.table_schema='public' and tc.constraint_type='PRIMARY KEY' order by tc.table_name,kcu.ordinal_position`)).rows;
 const keys=new Map();for(const r of pk){if(!keys.has(r.table_name))keys.set(r.table_name,[]);keys.get(r.table_name).push(r.column_name);}
 const fks=(await c.query(`select child.relname child,ca.attname child_column,parent.relname parent,pa.attname parent_column,con.conname from pg_constraint con join pg_class child on child.oid=con.conrelid join pg_namespace ns on ns.oid=child.relnamespace join pg_class parent on parent.oid=con.confrelid join pg_attribute ca on ca.attrelid=child.oid and ca.attnum=con.conkey[1] join pg_attribute pa on pa.attrelid=parent.oid and pa.attnum=con.confkey[1] where con.contype='f' and ns.nspname='public' and cardinality(con.conkey)=1`)).rows;
 const selected=new Map(), violations=[];
 const rootSets={partners:new Set([String(ids.partner)]),vendors:new Set(Object.values(ids.vendors).map(String)),users:new Set(Object.values(ids.users).map(String))};
 function owned(row){
  for(const [field,root] of [['partner_id','partners'],['host_partner_id','partners'],['vendor_id','vendors'],['owner_vendor_id','vendors']])if(row[field]!=null&&!rootSets[root].has(String(row[field])))return false;
  if(row.owner_org_type==='partner'&&row.owner_org_id!=null&&!rootSets.partners.has(String(row.owner_org_id)))return false;
  if(row.owner_org_type==='vendor'&&row.owner_org_id!=null&&!rootSets.vendors.has(String(row.owner_org_id)))return false;
  return true;
 }
 function add(table,rows){
  if(!rows.length)return 0;
  // Legacy join tables have no declared primary key. Their complete row is
  // the manifest identity; future cleanup must use null-safe exact equality.
  if(!keys.has(table))keys.set(table,tables.get(table));
  if(!selected.has(table))selected.set(table,new Map());let n=0;
  for(const row of rows){const key=JSON.stringify(keys.get(table).map(k=>row[k]));if(selected.get(table).has(key))continue;
   if(!owned(row)){violations.push({table,key,reason:'References another organization'});continue;}
   if(rootSets[table]&&!rootSets[table].has(String(row.id))){violations.push({table,key,reason:'Unexpected identity root'});continue;}
   selected.get(table).set(key,row);n++;
  }return n;
 }
 for(const [table,set] of Object.entries(rootSets)){const rows=(await c.query(`select * from ${q(table)} where id=ANY($1::int[])`,[[...set]])).rows;if(rows.length!==set.size)throw Error(`Missing ${table} roots`);
  for(const row of rows){if(table==='users'){if(!accounts.accounts.some(a=>a.id===row.id&&a.username===row.username)||!row.username.startsWith('prairie-demo-')||!row.username.endsWith('@example.invalid'))throw Error('Demo identity verification failed');}else if(row.blurb!==marker)throw Error('Synthetic marker mismatch');}add(table,rows);
 }
 // Explicit ownership selects polymorphic links not represented by database FKs.
 for(const [table,cols] of tables){if(rootSets[table])continue;const predicates=[],params=[];
  const clause=(sql,val)=>{params.push(val);predicates.push(sql.replace('?',`$${params.length}`));};
  for(const [field,root] of [['partner_id','partners'],['host_partner_id','partners'],['vendor_id','vendors'],['owner_vendor_id','vendors']])if(cols.includes(field))clause(`${q(field)}=ANY(?::int[])`,[...rootSets[root]]);
  if(cols.includes('owner_org_type')&&cols.includes('owner_org_id')){clause("(owner_org_type='partner' and owner_org_id=ANY(?::int[]))",[...rootSets.partners]);clause("(owner_org_type='vendor' and owner_org_id=ANY(?::int[]))",[...rootSets.vendors]);}
  if(predicates.length)add(table,(await c.query(`select * from ${q(table)} where ${predicates.join(' or ')}`,params)).rows);
 }
 // Follow inbound relationships. Never pull an unrelated parent into the copy.
 let changed=true,rounds=0;while(changed){changed=false;if(++rounds>40)throw Error('Dependency traversal did not converge');
  for(const fk of fks){const parents=selected.get(fk.parent);if(!parents?.size)continue;const values=[...new Set([...parents.values()].map(r=>r[fk.parent_column]).filter(v=>v!=null))];
   const rows=(await c.query(`select * from ${q(fk.child)} where ${q(fk.child_column)}::text=ANY($1::text[])`,[values.map(String)])).rows;
   if(add(fk.child,rows))changed=true;
  }
 }
 // Verify every outbound FK stays within the synthetic set. References needing
 // a neutral allowlist must be resolved explicitly, never silently copied.
 for(const fk of fks){const children=selected.get(fk.child);if(!children?.size)continue;const parentValues=new Set([...(selected.get(fk.parent)?.values()??[])].map(r=>String(r[fk.parent_column])));
  const missing=[...new Set([...children.values()].map(r=>r[fk.child_column]).filter(v=>v!=null&&!parentValues.has(String(v))))];
  if(missing.length)violations.push({table:fk.child,column:fk.child_column,parent:fk.parent,missing:missing.map(String),reason:'Outbound reference outside synthetic set'});
 }
 const data=Object.fromEntries([...selected].filter(([,v])=>v.size).map(([t,rows])=>[t,[...rows.values()]]));
 const counts=Object.fromEntries(Object.entries(data).map(([t,r])=>[t,r.length]));
 const manifest={version:report.version,createdAt:new Date().toISOString(),readOnly:true,keys:Object.fromEntries(keys),counts,violations,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),tables:data};
 await writeFile(new URL('../.local/prairie-demo-isolation-export.json',import.meta.url),JSON.stringify(manifest,null,2),{mode:0o600});
 await c.query('COMMIT');console.log(JSON.stringify({counts,violations,rows:Object.values(counts).reduce((a,b)=>a+b,0),safeToImport:violations.length===0}));
}finally{await c.end();}
