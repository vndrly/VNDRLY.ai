/** Additive fixtures only in the named isolated synthetic realm. Never reseeds or rotates credentials. */
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FleetStateSchema} from '../artifacts/api-server/src/services/fleet-repository';
import {FleetDestinationSchema,FleetTicketPlanSchema} from '../lib/api-zod/src/fleet-commercial';
import {FleetLocationObservationSchema} from '../lib/api-zod/src/fleet-location';
import {initialNativeState} from '../artifacts/api-server/src/services/native-operations-policy';
const root=process.env.VNDRLY_DEMO_PRIVATE_ROOT??process.cwd();
const config=JSON.parse(await readFile(`${root}/.local/prairie-demo-database-access.json`,'utf8'));
if(new URL(config.url).pathname!=='/vndrly_prairie_demo')throw Error('Production fallback prohibited');
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const c=new Client({connectionString:config.url});
const uuid=(key:string)=>{const h=createHash('sha256').update(`prairie-parity-v2:${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
try{await c.connect();await c.query('BEGIN');
if((await c.query('select current_database() name')).rows[0].name!=='vndrly_prairie_demo')throw Error('Wrong database');
const vendor=(await c.query('select * from vendors where id=1109 FOR UPDATE')).rows[0];
if(vendor?.name!=='Blue Horizon Logistics — Demo')throw Error('Synthetic owner mismatch');
const sites=(await c.query('select id,name,latitude,longitude,partner_id from site_locations where id=ANY($1::int[]) order by id',[[394,395,396]])).rows;
const assets=(await c.query("select id,name from assets where responsible_org_type='vendor' and responsible_org_id=1109 and retired_at IS NULL order by name")).rows;
const drivers=(await c.query("select user_id from vendor_people where vendor_id=1109 and user_id is not null and vendor_role='field_employee' order by id")).rows;
if(sites.length!==3||assets.length<2)throw Error('Required fixture references missing');
const driverIds=drivers.length?drivers.map((x:any)=>x.user_id):[1091,1092,1093,1094];
for(const id of driverIds){if(!(await c.query("select id from user_org_memberships where user_id=$1 and vendor_id=1109 and org_type='vendor'",[id])).rowCount)throw Error('Driver membership missing');}
const destination=FleetDestinationSchema.parse({id:uuid('destination'),revision:1,name:'Prairie Transfer Yard — Demo',kind:'delivery',address:'Fictional Prairie transfer yard, Oklahoma',latitude:35.55,longitude:-97.91,materials:['equipment'],hours:'Synthetic weekday schedule',instructions:'Fictional demo destination. No real delivery.',active:true,ownerType:'vendor',ownerId:1109});
const state=FleetStateSchema.parse(vendor.fleet_ops_state??{version:1,enabled:true,fleets:[],grants:[],supportGrants:[],runs:[],preferences:[],operations:[]});
state.enabled=true;
const fleetId=uuid('fleet');if(!state.fleets.some(f=>f.id===fleetId))state.fleets.push({id:fleetId,name:'Blue Horizon Demo Fleet',siteIds:sites.map((s:any)=>s.id),equipmentAssetIds:assets.map((a:any)=>a.id),requiredCertifications:[]});
for(const userId of [1085,1079,...driverIds])if(!state.grants.some(g=>g.userId===userId))state.grants.push({userId,fleetIds:[fleetId],siteIds:sites.map((s:any)=>s.id),roles:driverIds.includes(userId)?['driver']:['fleet_manager','dispatcher'],financeRead:!driverIds.includes(userId),safetyRelease:false});
const tickets=(await c.query('select id,site_location_id,status,created_at from tickets where vendor_id=1109 order by created_at')).rows;
for(let index=0;index<tickets.length;index++){
 const ticket=tickets[index],runId=uuid(`run:${ticket.id}`),site=sites.find((s:any)=>s.id===ticket.site_location_id);if(!site)throw Error('Site mismatch');
 const start=new Date(ticket.created_at).toISOString(),end=new Date(Date.parse(start)+3600000).toISOString(),driverUserId=driverIds[index%driverIds.length];
 const mode=index%2===0?'batch':'singles';
 const deviceId=`synthetic-demo-route-${driverUserId}`;
 await c.query('insert into location_consents(user_id,device_id,accepted_at) values($1,$2,$3) ON CONFLICT(user_id,device_id) DO NOTHING',[driverUserId,deviceId,start]);
 for(let sample=0;sample<=12;sample++){
  const recordedAt=new Date(Date.parse(start)+sample*300000).toISOString(),operationId=uuid(`point:${ticket.id}:${sample}`);
  const observation=FleetLocationObservationSchema.parse({runId,vehicleAssetId:assets[index%assets.length].id,driverUserId,latitude:Number(site.latitude)+(destination.latitude-Number(site.latitude))*sample/12,longitude:Number(site.longitude)+(destination.longitude-Number(site.longitude))*sample/12,accuracyMeters:15,recordedAt,receivedAt:recordedAt,source:'driver_phone',freshness:'stale',physicalProofVerified:false});
  const saved={operationId,fingerprint:'synthetic-demo-fixture',deviceId,assignment:JSON.stringify([runId,1109,driverUserId,observation.vehicleAssetId,null]),observation};
  await c.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status,created_at) SELECT $1,1109,'demo','synthetic','synthetic','demo_recorded_route','synthetic-fixture','fleet-location',$2,'{\"synthetic\":true}'::jsonb,$3::jsonb,'completed',$4 WHERE NOT EXISTS(SELECT 1 FROM assistant_action_audit WHERE vendor_id=1109 AND target_type='fleet-location' AND tool_output->>'operationId'=$5)",[driverUserId,runId,JSON.stringify(saved),recordedAt,operationId]);
 }
 // Fill between the preserved five-minute fixtures without replacing any sample.
 const minuteSamples=Array.from({length:61},(_,minute)=>minute).filter(minute=>minute%5!==0).map(minute=>{
  const recordedAt=new Date(Date.parse(start)+minute*60000).toISOString(),operationId=uuid(`minute-point:${ticket.id}:${minute}`);
  const observation=FleetLocationObservationSchema.parse({runId,vehicleAssetId:assets[index%assets.length].id,driverUserId,latitude:Number(site.latitude)+(destination.latitude-Number(site.latitude))*minute/60,longitude:Number(site.longitude)+(destination.longitude-Number(site.longitude))*minute/60,accuracyMeters:15,recordedAt,receivedAt:recordedAt,source:'driver_phone',freshness:'stale',physicalProofVerified:false});
  return {user_id:driverUserId,target_id:runId,operation_id:operationId,recorded_at:recordedAt,tool_output:{operationId,fingerprint:'synthetic-demo-fixture',deviceId,assignment:JSON.stringify([runId,1109,driverUserId,observation.vehicleAssetId,null]),observation}};
 });
 await c.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status,created_at) SELECT x.user_id,1109,'demo','synthetic','synthetic','demo_recorded_route','synthetic-fixture','fleet-location',x.target_id,'{\"synthetic\":true}'::jsonb,x.tool_output,'completed',x.recorded_at FROM jsonb_to_recordset($1::jsonb) AS x(user_id int,target_id text,operation_id text,recorded_at timestamptz,tool_output jsonb) WHERE NOT EXISTS(SELECT 1 FROM assistant_action_audit a WHERE a.vendor_id=1109 AND a.target_type='fleet-location' AND a.tool_output->>'operationId'=x.operation_id)",[JSON.stringify(minuteSamples)]);
 const plan=FleetTicketPlanSchema.parse({version:1,siteId:site.id,vendorId:1109,partnerId:site.partner_id,mode,rateCents:14500,currency:'USD',closure:'day',closesAt:null,destinations:[destination],closedAt:['funds_dispersed','approved','submitted'].includes(ticket.status)?end:null,createdByUserId:1085,createdAt:start,operations:[]});
 await c.query('update tickets set fleet_plan=$2::jsonb where id=$1 AND vendor_id=1109 AND fleet_plan IS NULL',[ticket.id,JSON.stringify(plan)]);
 const prior=await c.query("select 1 from assistant_action_audit where vendor_id=1109 AND target_type='fleet-run' AND target_id=$1",[runId]);
 if(!prior.rowCount&&!state.runs.some(r=>r.id===runId))state.runs.push({id:runId,fleetId,companyId:1109,title:`Synthetic equipment delivery · ${site.name} · ticket ${ticket.id}`,driverUserId,vehicleAssetId:assets[index%assets.length].id,trailerAssetId:null,siteIds:[site.id],status:'completed',phase:null,pausedFromPhase:null,records:[],version:1,stops:[{id:uuid(`pickup:${ticket.id}`),siteId:site.id,kind:'pickup',sequence:0},{id:uuid(`delivery:${ticket.id}`),siteId:site.id,kind:'delivery',sequence:1,destination}],loads:[],inspections:[],currentStopId:null,visitedStopIds:[uuid(`pickup:${ticket.id}`),uuid(`delivery:${ticket.id}`)],events:[{id:uuid(`event:${ticket.id}`),operationId:uuid(`op:${ticket.id}`),type:'synthetic_run_completed',actorUserId:driverUserId,recordedAt:end,details:{synthetic:true}}],linkedTicketId:ticket.id,allowedActions:[],commercial:{ticketId:ticket.id,originSiteId:site.id,mode,rateCents:14500,currency:'USD',approvedDestinations:[destination],destinationId:destination.id}});
}
FleetStateSchema.parse(state);
const settings=vendor.fleet_commercial_settings??{version:1,defaultMode:'singles',destinations:[destination],operations:[]};
await c.query('update vendors set fleet_ops_state=$2::jsonb,fleet_commercial_settings=$3::jsonb where id=$1 AND name=$4',[1109,JSON.stringify(state),JSON.stringify(settings),vendor.name]);
// Bridge preserved legacy synthetic shifts into the new coverage model once.
const gateVendor=(await c.query('select name from vendors where id=1110')).rows[0];
if(gateVendor?.name!=='Sentinel Prairie Gate Services — Demo')throw Error('Gate synthetic owner mismatch');
await c.query("UPDATE gate_stations g SET latitude=s.latitude,longitude=s.longitude FROM site_locations s WHERE s.id=g.site_id AND s.id=ANY($1::int[]) AND g.latitude IS NULL AND g.longitude IS NULL",[sites.map((s:any)=>s.id)]);
await c.query("INSERT INTO gate_duty_sessions(station_id,user_id,source_legacy_shift_id,started_at,ended_at,source,idempotency_key,post_coverage,end_reason) SELECT sh.station_id,sh.operator_id,sh.id,sh.started_at,COALESCE(sh.ended_at,sh.started_at+interval '8 hours'),'synthetic-demo-history','demo-parity:'||sh.id::text,jsonb_build_object('vendorId',1110,'synthetic',true),'Synthetic recorded shift' FROM gate_shifts sh JOIN gate_stations g ON g.id=sh.station_id WHERE g.site_id=ANY($1::int[]) AND EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.user_id=sh.operator_id AND m.vendor_id=1110) AND NOT EXISTS(SELECT 1 FROM gate_duty_sessions d WHERE d.source_legacy_shift_id=sh.id) ON CONFLICT DO NOTHING",[sites.map((s:any)=>s.id)]);
const gateSamples=(await c.query("SELECT sh.id,sh.operator_id,sh.started_at,g.latitude,g.longitude FROM gate_shifts sh JOIN gate_stations g ON g.id=sh.station_id WHERE g.site_id=ANY($1::int[]) AND EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.user_id=sh.operator_id AND m.vendor_id=1110)",[sites.map((s:any)=>s.id)])).rows.flatMap((shift:any)=>Array.from({length:17},(_,sample)=>({user_id:shift.operator_id,target_id:uuid(`gate-location:${shift.id}:${sample}`),captured_at:new Date(new Date(shift.started_at).getTime()+sample*1800000).toISOString(),tool_output:{synthetic:true,deviceId:`synthetic-gate-history-${shift.operator_id}`,location:{latitude:shift.latitude,longitude:shift.longitude,accuracy:15,capturedAt:new Date(new Date(shift.started_at).getTime()+sample*1800000).toISOString()}}})));
await c.query("INSERT INTO location_consents(user_id,device_id) SELECT DISTINCT x.user_id,x.tool_output->>'deviceId' FROM jsonb_to_recordset($1::jsonb) AS x(user_id int,tool_output jsonb) ON CONFLICT(user_id,device_id) DO NOTHING",[JSON.stringify(gateSamples)]);
for(const userId of [...new Set(gateSamples.map((sample:any)=>sample.user_id))]){
 const fixture=initialNativeState();fixture.designatedDeviceId=`synthetic-gate-history-${userId}`;fixture.consent.locationSharing=true;
 await c.query("INSERT INTO work_hub_device_preferences(user_id,owner_org_type,owner_org_id,native_operations) VALUES($1,'vendor',1110,$2::jsonb) ON CONFLICT(user_id,owner_org_type,owner_org_id) DO UPDATE SET native_operations=work_hub_device_preferences.native_operations || EXCLUDED.native_operations WHERE work_hub_device_preferences.native_operations->>'designatedDeviceId' IS NULL",[userId,JSON.stringify(fixture)]);
}
await c.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status,created_at) SELECT x.user_id,1110,'demo','synthetic','synthetic','demo_gate_history','synthetic-fixture','work-duty-location',x.target_id,x.tool_output,'completed',x.captured_at FROM jsonb_to_recordset($1::jsonb) AS x(user_id int,target_id text,tool_output jsonb,captured_at timestamptz) WHERE NOT EXISTS(SELECT 1 FROM assistant_action_audit a WHERE a.vendor_id=1110 AND a.target_type='work-duty-location' AND a.target_id=x.target_id)",[JSON.stringify(gateSamples)]);
await c.query('COMMIT');console.log(JSON.stringify({isolated:true,companyId:1109,fleets:state.fleets.length,historicalRunExamples:tickets.length,ticketPlans: tickets.length,credentialsUnchanged:true}));
}catch(error){await c.query('ROLLBACK');throw error;}finally{await c.end();}
