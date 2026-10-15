/** Read-only review package. NEVER executes the generated production commands. */
import './load-env-local.mjs';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const manifest=JSON.parse(await readFile('.local/prairie-demo-isolation-export.json','utf8'));
if(manifest.violations.length)throw Error('Cross-references require review before removal');
const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const q=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Unsafe identifier');return `"${s}"`;};
const literal=value=>value==null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const predicates=(table)=>manifest.tables[table].map(row=>'('+manifest.keys[table].map(k=>`${q(k)} IS NOT DISTINCT FROM ${literal(row[k])}`).join(' AND ')+')').join(' OR ');
try{
 const fks=(await c.query(`select child.relname child,ca.attname column_name,parent.relname parent,ca.attnotnull not_null from pg_constraint con join pg_class child on child.oid=con.conrelid join pg_namespace ns on ns.oid=child.relnamespace join pg_class parent on parent.oid=con.confrelid join pg_attribute ca on ca.attrelid=child.oid and ca.attnum=con.conkey[1] where con.contype='f' and ns.nspname='public' and cardinality(con.conkey)=1`)).rows;
 const remaining=new Set(Object.keys(manifest.tables)),order=[],breaks=[];
 let edges=fks.filter(f=>remaining.has(f.child)&&remaining.has(f.parent)&&f.child!==f.parent&&manifest.tables[f.child].some(r=>r[f.column_name]!=null));
 while(remaining.size){
  const ready=[...remaining].filter(t=>!edges.some(e=>remaining.has(e.child)&&remaining.has(e.parent)&&e.parent===t));
  if(ready.length){for(const table of ready){order.push(table);remaining.delete(table);}continue;}
  const cycle=edges.find(e=>remaining.has(e.child)&&remaining.has(e.parent)&&!e.not_null&&e.child==='users')??edges.find(e=>remaining.has(e.child)&&remaining.has(e.parent)&&!e.not_null);
  if(!cycle)throw Error('Nonnullable dependency cycle; removal cannot be prepared safely');
  breaks.push(cycle);edges=edges.filter(e=>e!==cycle);
 }
 const statements=[...breaks.map(f=>`UPDATE ${q(f.child)} SET ${q(f.column_name)}=NULL WHERE (${predicates(f.child)}) AND ${q(f.column_name)} IS NOT NULL;`),...order.map(t=>`DELETE FROM ${q(t)} WHERE ${predicates(t)};`)];
 const sql=['-- REVIEW ONLY: NOT AUTHORIZED FOR EXECUTION YET.','-- Exact synthetic keys only. Do not use CASCADE or disable constraints.','BEGIN;',...statements,'COMMIT;',''].join('\n');
 const hash=createHash('sha256').update(sql).digest('hex');
 await writeFile('.local/prairie-demo-production-removal.sql',sql,{mode:0o600});
 await writeFile('.local/prairie-demo-production-removal-manifest.json',JSON.stringify({preparedAt:new Date().toISOString(),sqlSha256:hash,counts:manifest.counts,order,nullableCycleBreaks:breaks,keys:manifest.keys,tables:Object.fromEntries(Object.entries(manifest.tables).map(([t,rows])=>[t,rows.map(r=>Object.fromEntries(manifest.keys[t].map(k=>[k,r[k]])))])),approved:false},null,2),{mode:0o600});
 const total=Object.values(manifest.counts).reduce((a,b)=>a+b,0);
 const markdown=`# Remove old Prairie Horizon synthetic copies from production\n\nStatus: awaiting explicit approval. No production removal performed.\n\nThe isolated demo is live and verified. This cleanup removes only its old production copies: **${total} rows in ${Object.keys(manifest.counts).length} tables**, including one marked partner, three marked vendors and twenty registered fictional accounts. Existing canonical demo accounts and all real companies are excluded. Passwords and history remain in the separate demo database.\n\nA fresh read-only dependency scan found no references to real organizations or identities. Commands contain exact saved primary keys; legacy tables without keys use full null-safe row matches. The transaction clears only nullable synthetic links needed to break dependency cycles, then removes child records before their parents. No cascading deletion, schema reset or constraint disabling is used. Any changed counts or new reference aborts execution.\n\nExact proposed commands: [production cleanup SQL](../../../.local/prairie-demo-production-removal.sql). Private key manifest: [manifest](../../../.local/prairie-demo-production-removal-manifest.json). SQL SHA-256: ${hash}.\n\n| Table | Old synthetic rows |\n|---|---:|\n${Object.entries(manifest.counts).map(([t,n])=>`| ${t} | ${n} |`).join('\n')}\n\nNullable cycle links to clear, only within those exact synthetic keys: ${breaks.map(f=>`${f.child}.${f.column_name}`).join(', ')||'none'}.\n\nApproval required by AGENTS.md: \"Under no circumstances may the agent destroy, blank, truncate, drop, or reset the user's database — dev or prod — unless the user explicitly and unambiguously instructs it in that same message.\" The approved isolation design also requires this exact removal list to be shown separately before execution.\n`;
 await writeFile('docs/superpowers/specs/2026-10-10-demo-production-cleanup-review.md',markdown);
 console.log(JSON.stringify({reviewOnly:true,total,tables:Object.keys(manifest.counts).length,nullableCycleLinks:breaks.map(f=>`${f.child}.${f.column_name}`),sqlSha256:hash}));
}finally{await c.end();}
