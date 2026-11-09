// Catalog reads take no table DDL/row locks. Only the source-declared contract is
// considered; unrelated later additive columns and indexes remain compatible.
const normalize=value=>String(value??'').replace(/\bpublic\.(?=(?:gen_random_uuid|now)\(\))/g,'').replace(/\s+/g,' ').trim().replace(/::(?:text|integer|boolean)$/,'');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function readAdditiveCatalog(client,contract){
 const tables=Object.keys(contract.columns),q=async(sql,args)=>(await client.query(sql,args)).rows;
 return {
 tables:await q(`SELECT c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[tables]),
 columns:await q(`SELECT c.relname AS table_name,a.attname AS name,t.typname AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped`,[tables]),
 constraints:await q(`SELECT c.relname AS table_name,x.contype AS type,x.convalidated AS validated,x.condeferrable AS deferrable,ARRAY(SELECT a.attname::text FROM unnest(x.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=x.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,r.relname AS target_table,rn.nspname AS target_schema,ARRAY(SELECT a.attname::text FROM unnest(x.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=x.confrelid AND a.attnum=k.num ORDER BY k.ord) AS target_columns,x.confdeltype AS delete_action,x.confupdtype AS update_action,x.confmatchtype AS match_type,ci.indnullsnotdistinct AS nulls_not_distinct,ci.indisvalid AS index_valid,ci.indisready AS index_ready FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class r ON r.oid=x.confrelid LEFT JOIN pg_namespace rn ON rn.oid=r.relnamespace LEFT JOIN pg_index ci ON ci.indexrelid=x.conindid WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[tables]),
 indexes:await q(`SELECT c.relname AS name,t.relname AS table_name,i.indisvalid AS valid,i.indisready AS ready,i.indisunique AS unique_index,i.indnullsnotdistinct AS nulls_not_distinct,am.amname AS method,i.indnatts=i.indnkeyatts AS no_includes,i.indoption::text AS options,ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k) AS columns,pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=c.relam WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[(contract.indexes??[]).map(i=>i.name)]),
 };
}
export function additiveCatalogProblems(catalog,contract){
 const problems=[];
 for(const [table,columns] of Object.entries(contract.columns)){
  const relation=catalog.tables.find(t=>t.name===table);
  if(!relation||relation.kind!=='r'||(contract.rls??[]).includes(table)&&!relation.rls)problems.push(`table/RLS:${table}`);
  for(const [name,wanted] of Object.entries(columns)){
   const found=catalog.columns.find(c=>c.table_name===table&&c.name===name);
   if(!found||found.type!==wanted.type||found.not_null!==wanted.notNull||normalize(found.default_value)!==normalize(wanted.defaultValue))problems.push(`column:${table}.${name}`);
  }
 }
 for(const c of contract.constraints??[]){
  if(!catalog.constraints.some(x=>x.table_name===c.table&&x.type===c.type&&!x.deferrable&&x.validated&&same(x.columns,c.columns)&&(c.type==='f'?x.target_schema==='public'&&x.target_table===c.target&&same(x.target_columns,c.targetColumns)&&x.delete_action===c.deleteAction&&x.update_action==='a'&&x.match_type==='s':x.index_valid&&x.index_ready&&!x.nulls_not_distinct)))problems.push(`constraint:${c.table}.${c.columns.join(',')}:${c.type}`);
 }
 for(const i of contract.indexes??[]){
  const x=catalog.indexes.find(x=>x.name===i.name),condition=v=>normalize(v).replace(/^\((.*)\)$/,'$1');
  if(!x||!x.valid||!x.ready||!x.no_includes||x.options.split(' ').some(v=>v!=='0')||x.method!=='btree'||x.table_name!==i.table||x.unique_index!==i.unique||x.nulls_not_distinct||!same(x.columns.map(normalize),i.columns.map(normalize))||condition(x.predicate)!==condition(i.predicate))problems.push(`index:${i.name}`);
 }
 return problems;
}
// Grammar intentionally covers this pinned additive source only; reject unknown
// column syntax rather than silently weakening the verified contract.
export function contractFromGateOperationsSql(sql){
 const contract={columns:{},constraints:[],indexes:[],rls:[]};
 function column(table,line){
  const match=line.trim().match(/^(\w+) (uuid|integer|text|timestamptz|double precision|boolean|jsonb)(.*)$/);if(!match)throw Error(`Unrecognized Gate column: ${line}`);
  const [,name,type,tail]=match,primary=/PRIMARY KEY/.test(tail);contract.columns[table]??={};contract.columns[table][name]={type:({integer:'int4',boolean:'bool','double precision':'float8'})[type]??type,notNull:primary||/NOT NULL/.test(tail),defaultValue:tail.match(/DEFAULT (.*?)(?= REFERENCES| UNIQUE|$)/)?.[1]};
  if(primary)contract.constraints.push({table,type:'p',columns:[name]});
  if(/\bUNIQUE\b/.test(tail))contract.constraints.push({table,type:'u',columns:[name]});
  const fk=tail.match(/REFERENCES (\w+)\((\w+)\)(?: ON DELETE (CASCADE))?/);if(fk)contract.constraints.push({table,type:'f',columns:[name],target:fk[1],targetColumns:[fk[2]],deleteAction:fk[3]?'c':'a'});
 }
 for(const [,table,body] of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g))for(const line of body.split('\n').map(l=>l.trim().replace(/,$/,'')).filter(Boolean)){const unique=line.match(/^UNIQUE\(([^)]+)\)$/);if(unique)contract.constraints.push({table,type:'u',columns:unique[1].split(',').map(x=>x.trim())});else column(table,line);}
 for(const [,table,definition] of sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS ([^;]+);/g))column(table,definition);
 for(const [,unique,name,table,columns,predicate] of sql.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)\(([^)]+)\)(?: WHERE ([^;]+))?;/g))contract.indexes.push({name,table,columns:columns.split(',').map(c=>c.trim()),unique:!!unique,predicate});
 contract.rls=[...sql.matchAll(/ALTER TABLE (\w+) ENABLE ROW LEVEL SECURITY;/g)].map(x=>x[1]);
 return contract;
}
