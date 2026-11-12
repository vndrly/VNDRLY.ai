import { getGateOperatingContext, requireGateOperatingContext } from "./gate-change-over";
import { pool } from '@workspace/db';
import { z } from 'zod';
import type { SessionPayload } from '../lib/session';
import { ChangeOverError, changeOverTransaction, requireChangeOverAccess, requireGateStationManagementAccess } from './gate-change-over';

export const topologySchema = z.object({
  kind:z.enum(['independent','parallel','series']),
  area:z.string().trim().max(100).default(''),
  parentGateId:z.string().uuid().nullable().default(null),
  parallelGateId:z.string().uuid().nullable().default(null),
  destinations:z.array(z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),gateId:z.string().uuid().nullable(),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional()})).max(50).optional(),
  defaultDestinationId:z.string().uuid().nullable().optional(),
}).strict();
export type GateTopology = z.infer<typeof topologySchema>;
export type GateMovement = {operationId:string;kind:'enter'|'leave'|'route'|'site_exit';gateId:string;gateName:string;area:string;destinationGateId:string|null;destination:string;at:string;actorId:number;actorName?:string;note?:string;destinationId?:string};
const fail=(status:number,message:string):never=>{throw new ChangeOverError(status,'gate_topology.rejected',message);};
export function movementPresence(movements:GateMovement[], entryGateId:string|null, closed:boolean) {
  const last=movements.at(-1);
  let currentGateId=entryGateId, lastConfirmedGateId=entryGateId, lastConfirmedLocation='Property entrance';
  for(const movement of movements){
    if(movement.kind==='enter') {currentGateId=movement.gateId;lastConfirmedGateId=movement.gateId;lastConfirmedLocation=movement.area||movement.gateName;}
    else if(movement.kind==='leave'||movement.kind==='site_exit') {currentGateId=null;lastConfirmedGateId=movement.gateId;lastConfirmedLocation=movement.kind==='site_exit'?'Exited property':`Departed ${movement.area||movement.gateName}`;}
  }
  const expectedGateId=closed?null:last?.destinationGateId??null;
  const expectedSiteExit=!closed&&last?.destination==='site_exit';
  const intendedDestination=closed?null:last?.destination==='remain'?null:last?.destination??null;
  return {currentGateId:closed?null:currentGateId,lastConfirmedGateId,lastConfirmedLocation,expectedGateId,expectedSiteExit,intendedDestination,
    label:closed?'Departed site':last?.kind==='enter'?(last.area?`Inside ${last.area}`:`Checked in at ${last.gateName}`):expectedSiteExit?`On Site · Awaiting outer checkout`:expectedGateId?'On Site · Awaiting inner arrival':last?'On site · Outside secure areas':'On site'};
}

/** The sole configured child is the default; explicit destination lists also allow ungated places. */
export function gateDestinations(gates:Array<{id:string;name:string;active?:boolean;topology?:GateTopology|null}>,gateId:string) {
  const gate=gates.find(g=>g.id===gateId);
  return gate?.topology?.destinations??gates.filter(g=>g.active!==false&&g.topology?.parentGateId===gateId&&g.topology?.kind==='series').map(g=>({id:g.id,name:g.topology?.area||g.name,gateId:g.id}));
}
export function resolveGateDestination(gates:Parameters<typeof gateDestinations>[0],gateId:string,destinationId?:string) {
  const choices=gateDestinations(gates,gateId),configured=gates.find(g=>g.id===gateId)?.topology?.defaultDestinationId;
  const id=destinationId??configured??(choices.length===1?choices[0].id:undefined);
  if(!id)return null;
  const destination=choices.find(d=>d.id===id);
  if(!destination)return fail(400,'Choose a configured destination at this gate.');
  if(destination.gateId&&!gates.some(g=>g.id===destination.gateId&&g.active!==false))fail(400,'Destination gate unavailable at this site.');
  return destination;
}
export function confirmedSecureArea(history:GateMovement[]) {
  let area='';
  for(const movement of history) {if(movement.kind==='enter')area=movement.area;else if(movement.kind==='leave'||movement.kind==='site_exit')area='';}
  return area;
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
  if(value.destinations){
    if(new Set(value.destinations.map(d=>d.id)).size!==value.destinations.length)fail(400,'Destination IDs must be unique.');
    for(const d of value.destinations)if(d.gateId&&(!byId.has(d.gateId)||d.gateId===gateId))fail(400,'Choose another gate at this site for the destination.');
    if(value.defaultDestinationId&&!value.destinations.some(d=>d.id===value.defaultDestinationId))fail(400,'Choose a configured default destination.');
  }
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
  // Topology administration and recording a crossing are different permissions.
  const movementGateIds:string[]=[];
  const {operatingGate}=await getGateOperatingContext(session);
  if(operatingGate?.siteId===siteId&&topology.gates.some(gate=>gate.active&&gate.id===operatingGate.stationId))movementGateIds.push(operatingGate.stationId);
  const visits=(await pool.query(`SELECT id,first_name AS "firstName",last_name AS "lastName",company,vehicle_plate AS "vehiclePlate",gate_station_id AS "entryGateId",check_in_time AS "checkInTime",check_out_time AS "checkOutTime",gate_movements AS movements FROM site_visits WHERE site_location_id=$1 AND admission_status IS DISTINCT FROM 'pending' AND admission_status IS DISTINCT FROM 'denied' AND reconciliation_state IS DISTINCT FROM 'confirmed_off_site' AND (check_out_time IS NULL OR check_out_time>now()-interval '30 days') ORDER BY check_in_time DESC`,[siteId])).rows;
  const actorIds=[...new Set(visits.flatMap(v=>(v.movements as GateMovement[]).map(m=>m.actorId)))];
  const actors=actorIds.length?(await pool.query('SELECT id,display_name FROM users WHERE id=ANY($1::int[])',[actorIds])).rows:[];
  const names=new Map(actors.map(a=>[a.id,a.display_name]));
  return {...topology,movementGateIds,visits:visits.map(v=>({...v,movements:v.movements.map((m:GateMovement)=>({...m,actorName:names.get(m.actorId)??`User #${m.actorId}`})),presence:movementPresence(v.movements,v.entryGateId,!!v.checkOutTime)}))};
}
export const movementSchema=z.object({siteId:z.number().int().positive(),gateId:z.string().uuid(),visitId:z.number().int().positive(),operationId:z.string().uuid(),kind:z.enum(['enter','leave','route','site_exit']),destinationGateId:z.string().uuid().nullable().optional(),destination:z.enum(['site_exit','remain']).optional(),destinationId:z.string().uuid().optional()}).strict();
export async function recordGateMovement(session:SessionPayload,input:z.infer<typeof movementSchema>) {
  if(session.publicDemo||session.realm==='demo')fail(403,'This session is read only.');
  return changeOverTransaction(async c=>{
    await requireChangeOverAccess(c,session,input.siteId,{stationId:input.gateId});
    await requireGateOperatingContext(session,input.siteId,input.gateId,c);
    const gate=(await c.query('SELECT id,name,topology FROM gate_stations WHERE id=$1 AND site_id=$2 AND active=true',[input.gateId,input.siteId])).rows[0];
    if(!gate)fail(404,'Gate unavailable at this site.');
    const visit=(await c.query('SELECT id,gate_station_id,gate_movements,check_out_time FROM site_visits WHERE id=$1 AND site_location_id=$2 FOR UPDATE',[input.visitId,input.siteId])).rows[0];
    if(!visit)fail(404,'Visit unavailable at this site.');
    const history:GateMovement[]=visit.gate_movements??[];
    const prior=history.find(m=>m.operationId===input.operationId);
    if(prior){
      if(prior.gateId!==input.gateId||prior.kind!==input.kind||(prior.destinationId??null)!==(input.destinationId??null)||(!input.destinationId&&(prior.destinationGateId!==(input.destinationGateId??null)||(!input.destinationGateId&&prior.destination!==(input.kind==='enter'?'remain':input.destination??'remain')))))fail(409,'This movement was already saved with different details.');
      return {movement:prior};
    }
    if(visit.check_out_time)fail(409,'This site visit has already ended.');
    if(input.kind==='enter'&&!gate.topology?.area)fail(400,'Use property check-in at an outer gate.');
    const area=confirmedSecureArea(history);
    if(area&&(input.kind==='route'||input.kind==='enter'))fail(409,'Record checkout from the confirmed secure area before routing elsewhere.');
    if(input.kind==='leave'&&(!area||area!==gate.topology?.area))fail(409,'This vehicle is no longer confirmed in this secure area. Refresh the queue.');
    let destinationGateId=input.destinationGateId??null;
    let destination:string=input.destination??'remain';
    if(input.destinationId){
      const gates=(await c.query('SELECT id,name,active,topology FROM gate_stations WHERE site_id=$1',[input.siteId])).rows;
      const target=resolveGateDestination(gates,visit.gate_station_id,input.destinationId);
      if(target){destinationGateId=target.gateId;destination=target.name;}
    }
    if(input.kind==='enter'){destinationGateId=null;destination='remain';}
    if(input.kind==='site_exit')fail(400,'Record site departure with the site check-out control.');
    if(destinationGateId){const target=(await c.query('SELECT name FROM gate_stations WHERE id=$1 AND site_id=$2 AND active=true',[destinationGateId,input.siteId])).rows[0];if(!target)fail(400,'Choose an active destination at this site.');destination=target.name;}
    const movement:GateMovement={operationId:input.operationId,kind:input.kind,gateId:gate.id,gateName:gate.name,area:gate.topology?.area??'',destinationGateId,destination,at:new Date().toISOString(),actorId:session.userId!,...(input.destinationId?{destinationId:input.destinationId}:{})};
    await c.query('UPDATE site_visits SET gate_movements=gate_movements || $2::jsonb WHERE id=$1',[visit.id,JSON.stringify([movement])]);
    return {movement,warning:null};
  });
}
