/** Read-only isolation inventory. Prints counts and capability flags, never credentials. */
import './load-env-local.mjs';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const report=JSON.parse(await readFile(new URL('../.local/prairie-demo-report.json',import.meta.url),'utf8'));
const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
try {
 const capabilities=(await c.query('select rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname=current_user')).rows[0];
 const columns=(await c.query("select table_name,column_name from information_schema.columns where table_schema='public' and column_name in ('partner_id','vendor_id','owner_org_type','owner_org_id','user_id','created_by_id','created_by_user_id') order by table_name,column_name")).rows;
 const known=new Map();for(const row of columns){if(!known.has(row.table_name))known.set(row.table_name,new Set());known.get(row.table_name).add(row.column_name);}
 const counts=[];const users=Object.values(report.ids.users),vendors=Object.values(report.ids.vendors);
 for(const [table,cols] of known){
  if(!/^[a-z_][a-z0-9_]*$/.test(table))throw Error('Invalid schema identifier');const predicates=[],params=[];
  const add=(expr,value)=>{params.push(value);predicates.push(expr.replace('?',`$${params.length}`));};
  if(cols.has('partner_id'))add('partner_id=?',report.ids.partner);
  if(cols.has('vendor_id'))add('vendor_id=ANY(?::int[])',vendors);
  if(cols.has('owner_org_type')&&cols.has('owner_org_id')){add("(owner_org_type='partner' and owner_org_id=?)",report.ids.partner);add("(owner_org_type='vendor' and owner_org_id=ANY(?::int[]))",vendors);}
  for(const field of ['user_id','created_by_id','created_by_user_id'])if(cols.has(field))add(`${field}=ANY(?::int[])`,users);
  if(!predicates.length)continue;const n=(await c.query(`select count(*)::int n from "${table}" where ${predicates.join(' or ')}`,params)).rows[0].n;if(n)counts.push({table,directlyLinkedRows:n});
 }
 const result={readOnly:true,version:report.version,capabilities,organizations:{partners:1,vendors:vendors.length},accounts:users.length,counts,note:'Direct ownership and identity links only; dependent foreign-key rows must be included in the cutover manifest.'};
 await writeFile(new URL('../.local/prairie-demo-isolation-inventory.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await c.end();}
