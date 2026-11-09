import { createHash } from "node:crypto";
// Read-only catalog preflight avoids replaying no-op DDL locks on live Gate traffic.
const columns = {
  gate_stations: {id:['uuid',true,'gen_random_uuid()'],site_id:['int4',true],name:['text',true],created_at:['timestamptz',true,'now()']},
  gate_shifts: {id:['uuid',true,'gen_random_uuid()'],station_id:['uuid',true],operator_id:['int4',true],started_at:['timestamptz',true,'now()'],ended_at:['timestamptz',false],preparation_id:['uuid',false]},
  gate_preparations: {id:['uuid',true,'gen_random_uuid()'],shift_id:['uuid',true],prepared_by:['int4',true],snapshot:['jsonb',true],notes:['text',true],summary:['jsonb',true],created_at:['timestamptz',true,'now()']},
  gate_handovers: {id:['uuid',true],preparation_id:['uuid',true],incoming_shift_id:['uuid',true],incoming_user_id:['int4',true],outgoing_name:['text',true],incoming_name:['text',true],acknowledged_at:['timestamptz',true,'now()']},
  gate_shift_actions: {id:['uuid',true,'gen_random_uuid()'],station_id:['uuid',true],actor_id:['int4',true],item_id:['uuid',true],kind:['text',true],text:['text',true],created_at:['timestamptz',true,'now()']},
};
const foreignKeys = {
  gate_stations: [['site_id','site_locations','id','c']],
  gate_shifts: [['station_id','gate_stations','id','a'],['operator_id','users','id','a']],
  gate_preparations: [['shift_id','gate_shifts','id','a'],['prepared_by','users','id','a']],
  gate_handovers: [['preparation_id','gate_preparations','id','a'],['incoming_shift_id','gate_shifts','id','a'],['incoming_user_id','users','id','a']],
  gate_shift_actions: [['station_id','gate_stations','id','a'],['actor_id','users','id','a']],
};
const triggers=[['gate_change_over_default_station','site_locations','gate_change_over_provision_station',5],['gate_preparations_immutable','gate_preparations','gate_change_over_immutable',27],['gate_handovers_immutable','gate_handovers','gate_change_over_immutable',27],['gate_shift_actions_immutable','gate_shift_actions','gate_change_over_immutable',27]];
const normalize=value=>String(value??'').replace(/\bpublic\./g,'').replace(/\s+/g,' ').trim();
export function assertAdditiveGateMigration(migration) {
  if (/\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i.test(migration)) throw Error('Non-additive Change Over migration refused');
  if (createHash('sha256').update(migration.replace(/\r\n/g,'\n')).digest('hex') !== 'e6ee4856e489eb4ca5dbb009970c3e4be9305c415f9202f8ebc23d3327fff61b') throw Error('Change Over SQL changed; update its verified catalog contract before deployment');
}
export async function readGateMigrationCatalog(client) {
  const tables=Object.keys(columns);
  const query=async(sql,values)=> (await client.query(sql,values)).rows;
  return {
    tables:await query(`SELECT c.relname AS name,c.relrowsecurity AS rls,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[tables]),
    columns:await query(`SELECT c.relname AS table_name,a.attname AS name,t.typname AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped`,[tables]),
    constraints:await query(`SELECT c.relname AS table_name,x.contype AS type,x.convalidated AS validated,ARRAY(SELECT a.attname::text FROM unnest(x.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=x.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,r.relname AS target_table,rn.nspname AS target_schema,x.confupdtype AS update_action,ARRAY(SELECT a.attname::text FROM unnest(x.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=x.confrelid AND a.attnum=k.num ORDER BY k.ord) AS target_columns,x.confdeltype AS delete_action,ci.indisvalid AS index_valid,ci.indisready AS index_ready FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class r ON r.oid=x.confrelid LEFT JOIN pg_namespace rn ON rn.oid=r.relnamespace LEFT JOIN pg_index ci ON ci.indexrelid=x.conindid WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[tables]),
    indexes:await query(`SELECT c.relname AS name,t.relname AS table_name,i.indisvalid AS valid,i.indisready AS ready,i.indisunique AS unique_index,am.amname AS method,ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k) AS columns,pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=c.relam WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[['gate_stations_site_name_unique','gate_shifts_active_unique','gate_preparations_shift_idx','gate_handovers_recent_idx','gate_shift_actions_item_idx','site_visits_site_checkin_idx','ticket_check_ins_ticket_time_idx','ticket_check_ins_gate_time_idx','ticket_status_history_ticket_status_time_idx','work_hub_task_events_task_type_time_idx','assistant_action_audit_vendor_target_idx']]),
    triggers:await query(`SELECT t.tgname AS name,c.relname AS table_name,t.tgenabled AS enabled,t.tgtype AS type,p.proname AS function_name,nf.nspname AS function_schema,t.tgqual IS NULL AS unconditional,t.tgnargs AS argument_count,t.tgattr::text='' AS all_columns FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname=ANY($1::text[])`,[triggers.map(t=>t[0])]),
    functions:await query(`SELECT p.proname AS name,p.prosrc AS body,p.prosecdef AS security_definer,l.lanname AS language,p.prorettype::regtype::text AS returns,p.pronargs AS arguments FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname=ANY($1::text[])`,[['gate_change_over_provision_station','gate_change_over_immutable']]),
  };
}
export function gateMigrationCatalogProblems(catalog,migration) {
  const problems=[];
  for(const [table,fields] of Object.entries(columns)) {
    const existing=catalog.tables.find(t=>t.name===table);
    if(!existing?.rls||existing.kind!=='r')problems.push(`table/RLS:${table}`);
    for(const [name,[type,notNull,defaultValue]] of Object.entries(fields)) {
      const field=catalog.columns.find(c=>c.table_name===table&&c.name===name);
      if(!field||field.type!==type||field.not_null!==notNull||(normalize(field.default_value)!==normalize(defaultValue)))problems.push(`column:${table}.${name}`);
    }
    if(!catalog.constraints.some(c=>c.table_name===table&&c.type==='p'&&c.index_valid&&c.index_ready&&JSON.stringify(c.columns)==='["id"]'))problems.push(`primary-key:${table}`);
    for(const [field,target,targetField,action] of foreignKeys[table])if(!catalog.constraints.some(c=>c.table_name===table&&c.type==='f'&&c.validated&&JSON.stringify(c.columns)===JSON.stringify([field])&&c.target_table===target&&c.target_schema==='public'&&c.update_action==='a'&&JSON.stringify(c.target_columns)===JSON.stringify([targetField])&&c.delete_action===action))problems.push(`foreign-key:${table}.${field}`);
  }
  if(!catalog.constraints.some(c=>c.table_name==='gate_handovers'&&c.type==='u'&&c.index_valid&&c.index_ready&&JSON.stringify(c.columns)==='["preparation_id"]'))problems.push('unique:gate_handovers.preparation_id');
  for(const match of migration.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)\(([^)]+)\)(?: WHERE ([^;]+))?;/g)) {
    const [,unique,name,table,fields,predicate]=match,index=catalog.indexes.find(i=>i.name===name);
    const condition=value=>normalize(value).replace(/^\((.*)\)$/,'$1');
    if(!index||!index.valid||!index.ready||index.method!=='btree'||index.table_name!==table||index.unique_index!==Boolean(unique)||JSON.stringify(index.columns.map(normalize))!==JSON.stringify(fields.split(',').map(normalize))||condition(index.predicate)!==condition(predicate))problems.push(`index:${name}`);
  }
  for(const [name,table,fn,type] of triggers)if(!catalog.triggers.some(t=>t.name===name&&t.table_name===table&&['O','A'].includes(t.enabled)&&t.type===type&&t.function_name===fn&&t.function_schema==='public'&&t.unconditional&&t.all_columns&&t.argument_count===0))problems.push(`trigger:${name}`);
  for(const match of migration.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/g)) {
    const [,name,body]=match;
    if(!catalog.functions.some(f=>f.name===name&&f.arguments===0&&f.returns==='trigger'&&f.language==='plpgsql'&&!f.security_definer&&normalize(f.body)===normalize(body)))problems.push(`function:${name}`);
  }
  return problems;
}
export async function applyGateChangeOverMigration(client,migration) {
  assertAdditiveGateMigration(migration);
  const problems=gateMigrationCatalogProblems(await readGateMigrationCatalog(client),migration);
  if(!problems.length)return {applied:false,verified:true};
  console.log('Change Over catalog requires additive migration:',problems.join(', '));
  await client.query("SET lock_timeout='5s'");
  try {await client.query(migration);}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  const remaining=gateMigrationCatalogProblems(await readGateMigrationCatalog(client),migration);
  if(remaining.length)throw Error(`Change Over migration postflight failed: ${remaining.join(', ')}`);
  return {applied:true,verified:true};
}
