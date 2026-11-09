import {createHash} from 'node:crypto';
import {readAdditiveCatalog,additiveCatalogProblems,contractFromGateOperationsSql} from './gate-additive-catalog.mjs';
export function gateOperationsContract(sql){
 if(createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex')!=='5e0469b9697cd5b39e8f1416d207a7454b5dda1276f63340cf3dd94b3d5704ea')throw Error('Gate operations SQL changed; update its verified catalog contract');
 if(/\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i.test(sql))throw Error('Non-additive Gate operations migration refused');
 return contractFromGateOperationsSql(sql);
}
export async function applyGateOperationsMigration(client,sql){
 const contract=gateOperationsContract(sql);
 const problems=additiveCatalogProblems(await readAdditiveCatalog(client,contract),contract);
 if(problems.length){
  await client.query("SET lock_timeout='5s'");await client.query("SET statement_timeout='30s'");
  try{await client.query(sql);}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  const remaining=additiveCatalogProblems(await readAdditiveCatalog(client,contract),contract);
  if(remaining.length)throw Error(`Gate operations migration postflight failed: ${remaining.join(', ')}`);
  return {applied:true,verified:true};
 }
 // A correct schema can still need legacy duty backfill. Do that DML without
 // replaying CREATE INDEX / ENABLE RLS against live writers.
 const pending=(await client.query(`SELECT EXISTS(SELECT 1 FROM public.gate_shifts s WHERE s.ended_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.gate_duty_sessions d WHERE d.station_id=s.station_id AND d.user_id=s.operator_id AND d.ended_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.gate_duty_sessions d WHERE d.source_legacy_shift_id=s.id)) AS pending`)).rows[0].pending;
 if(!pending)return {applied:false,verified:true};
 const backfill=sql.match(/INSERT INTO gate_duty_sessions\([\s\S]*?ON CONFLICT \(source_legacy_shift_id\) DO NOTHING;/)?.[0];
 if(!backfill)throw Error('Gate operations backfill contract missing');
 await client.query('BEGIN');
 try{await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='30s'");await client.query(backfill);const remaining=additiveCatalogProblems(await readAdditiveCatalog(client,contract),contract);if(remaining.length)throw Error(`Gate operations backfill postflight failed: ${remaining.join(', ')}`);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 return {applied:false,backfilled:true,verified:true};
}
