import { pool } from '@workspace/db';
import { z } from 'zod';
import type { SessionPayload } from '../lib/session';
import { ChangeOverError, changeOverTransaction, requireChangeOverAccess, requireGateStationManagementAccess } from './gate-change-over';

export const topologySchema = z.object({
  kind:z.enum(['independent','parallel','series']),
  area:z.string().trim().max(100).default(''),
  parentGateId:z.string().uuid().nullable().default(null),
  parallelGateId:z.string().uuid().nullable().default(null),
}).strict();
export type GateTopology = z.infer<typeof topologySchema>;
export type GateMovement = {operationId:string;kind:'enter'|'leave'|'route'|'site_exit';gateId:string;gateName:string;area:string;destinationGateId:string|null;destination:string;at:string;actorId:number};
const fail=(status:number,message:string):never=>{throw new ChangeOverError(status,'gate_topology.rejected',message);};
export function movementPresence(movements:GateMovement[], entryGateId:string|null, closed:boolean) {
  const last=movements.at(-1);
  let currentGateId=entryGateId;
  for(const movement of movements){if(movement.kind==='enter')currentGateId=movement.gateId;else if(movement.kind==='leave'||movement.kind==='site_exit')currentGateId=null;}
  return {currentGateId:closed?null:currentGateId,
    expectedGateId:closed?null:last?.destinationGateId??null,
    expectedSiteExit:!closed&&last?.destination==='site_exit',
    label:closed?'Departed site':last?.kind==='enter'?(last.area?`Inside ${last.area}`:`Checked in at ${last.gateName}`):last?.destination==='site_exit'?last.kind==='leave'?`Left ${last.gateName} · Expected at Main Gate`:'On site · Expected at Main Gate':last?.destinationGateId?`On site · Heading to ${last.destination}`:last?'On site · Outside secure areas':'On site'};
}
export function validateGateTopology(gates:Array<{id:string;topology?:GateTopology|null}>,gateId:string,topology:GateTopology) {
  const byId=new Map(gates.map(g=>[g.id,g]));
  let value={...topology};
  if(value.kind==='parallel') {
    const peer=byId.get(value.parallelGateId??'');
    if(!peer||peer.id===gateId)return fail(400,'Choose another entrance at this site.');
    value={...value,area:peer.topology?.area??'',parentGateId:peer.topology?.parentGateId??null};
  } else if(value.kind==='series') {
    if(!value.area)fail(400,'Name the secure area.');
    if(!value.parentGateId||!byId.has(value.parentGateId))fail(400,'Choose the gate people pass through first.');
  } else value={...value,area:'',parentGateId:null,parallelGateId:null};
  const seen=new Set([gateId]);let parent=value.parentGateId;
  while(parent){if(seen.has(parent))fail(400,'A gate cannot be upstream of itself.');seen.add(parent);parent=byId.get(parent)?.topology?.parentGateId??null;}
  return value;
}
export async function readGateTopology(session:SessionPayload,siteId:number) {
  await requireChangeOverAccess(pool,session,siteId);
  const gates=(await pool.query('SELECT id,name,site_id AS "siteId",latitude,longitude,active,version,topology FROM gate_stations WHERE site_id=$1 ORDER BY name',[siteId])).rows;
  let canManage=false;
  try {await requireGateStationManagementAccess(pool,session,siteId);canManage=true;} catch(e) {if(!(e instanceof ChangeOverError)||e.status!==403)throw e;}
  return {gates,canManage};
}
export async function saveGateTopology(session:SessionPayload,siteId:number,gateId:string,topology:GateTopology,expectedVersion:number) {
  if(session.publicDemo||session.realm==='demo')fail(403,'This session is read only.');
  return changeOverTransaction(async c=>{
    await requireGateStationManagementAccess(c,session,siteId);
    // Serialize hierarchy edits so concurrent saves cannot create a cycle.
    await c.query('SELECT pg_advisory_xact_lock($1)',[siteId]);
    const gates=(await c.query('SELECT id,topology FROM gate_stations WHERE site_id=$1',[siteId])).rows;
    if(!gates.some(g=>g.id===gateId))fail(404,'Gate not found at this site.');
    const value=validateGateTopology(gates,gateId,topology);
    const row=(await c.query('UPDATE gate_stations SET topology=$3,version=version+1 WHERE id=$1 AND site_id=$2 AND version=$4 RETURNING *',[gateId,siteId,JSON.stringify(value),expectedVersion])).rows[0];
    if(!row)fail(409,'This gate changed. Refresh its details and try again.');
    return row;
  });
}
export async function readGateMovements(session:SessionPayload,siteId:number) {
  const topology=await readGateTopology(session,siteId);
  const visits=(await pool.query(`SELECT id,first_name AS "firstName",last_name AS "lastName",company,vehicle_plate AS "vehiclePlate",gate_station_id AS "entryGateId",check_in_time AS "checkInTime",check_out_time AS "checkOutTime",gate_movements AS movements FROM site_visits WHERE site_location_id=$1 AND admission_status IS DISTINCT FROM 'pending' AND admission_status IS DISTINCT FROM 'denied' AND reconciliation_state IS DISTINCT FROM 'confirmed_off_site' AND (check_out_time IS NULL OR check_out_time>now()-interval '30 days') ORDER BY check_in_time DESC`,[siteId])).rows;
  return {...topology,visits:visits.map(v=>({...v,presence:movementPresence(v.movements,v.entryGateId,!!v.checkOutTime)}))};
}
export const movementSchema=z.object({siteId:z.number().int().positive(),gateId:z.string().uuid(),visitId:z.number().int().positive(),operationId:z.string().uuid(),kind:z.enum(['enter','leave','route','site_exit']),destinationGateId:z.string().uuid().nullable().optional(),destination:z.enum(['site_exit','remain']).optional()}).strict();
export async function recordGateMovement(session:SessionPayload,input:z.infer<typeof movementSchema>) {
  if(session.publicDemo||session.realm==='demo')fail(403,'This session is read only.');
  return changeOverTransaction(async c=>{
    await requireChangeOverAccess(c,session,input.siteId);
    const gate=(await c.query('SELECT id,name,topology FROM gate_stations WHERE id=$1 AND site_id=$2 AND active=true',[input.gateId,input.siteId])).rows[0];
    if(!gate)fail(404,'Gate unavailable at this site.');
    const visit=(await c.query('SELECT id,gate_movements,check_out_time FROM site_visits WHERE id=$1 AND site_location_id=$2 FOR UPDATE',[input.visitId,input.siteId])).rows[0];
    if(!visit)fail(404,'Visit unavailable at this site.');
    const history:GateMovement[]=visit.gate_movements??[];
    const prior=history.find(m=>m.operationId===input.operationId);
    if(prior){
      if(prior.gateId!==input.gateId||prior.kind!==input.kind||prior.destinationGateId!==(input.destinationGateId??null)||(!input.destinationGateId&&prior.destination!==(input.kind==='enter'?'remain':input.destination??'remain')))fail(409,'This movement was already saved with different details.');
      return {movement:prior};
    }
    if(visit.check_out_time)fail(409,'This site visit has already ended.');
    let destinationGateId=input.destinationGateId??null,destination=input.destination??'remain';
    if(input.kind==='enter'){destinationGateId=null;destination='remain';}
    if(input.kind==='site_exit')fail(400,'Record site departure with the site check-out control.');
    if(destinationGateId){const target=(await c.query('SELECT name FROM gate_stations WHERE id=$1 AND site_id=$2 AND active=true',[destinationGateId,input.siteId])).rows[0];if(!target)fail(400,'Choose an active destination at this site.');destination=target.name;}
    const movement:GateMovement={operationId:input.operationId,kind:input.kind,gateId:gate.id,gateName:gate.name,area:gate.topology?.area??'',destinationGateId,destination,at:new Date().toISOString(),actorId:session.userId!};
    const warning=input.kind==='site_exit'&&history.at(-1)?.kind==='enter'&&history.at(-1)?.area?'Site departure recorded; internal area exit was not recorded.':null;
    await c.query(`UPDATE site_visits SET gate_movements=gate_movements || $2::jsonb,check_out_time=CASE WHEN $3 THEN now() ELSE check_out_time END,check_out_notes=CASE WHEN $3 THEN concat_ws(E'\n',check_out_notes,$4::text) ELSE check_out_notes END WHERE id=$1`,[visit.id,JSON.stringify([movement]),input.kind==='site_exit',warning]);
    return {movement,warning};
  });
}
