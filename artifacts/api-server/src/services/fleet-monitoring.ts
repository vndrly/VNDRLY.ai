import {randomUUID,createHash} from "node:crypto";
import {z} from "zod/v4";
import {pool} from "@workspace/db";
import {FleetTriggerRuleSchema,FleetTriggerSaveSchema,FleetRunSchema,FleetLocationObservationSchema,FleetComplianceConfigurationSchema,FleetAssignmentDeliverySchema,evaluateFleetTriggers,type FleetRun,type FleetTriggerEvent,type FleetTriggerRule} from "@workspace/api-zod";
import type {FleetActor} from "./fleet-ops";
import type {FleetState} from "./fleet-repository";
import {FleetError} from "./fleet-repository";
import type {PoolClient} from "pg";
import {readCompleteFleetRunEvents} from "./fleet-run-events";
import {notifyUsers} from "../routes/notifications";
type Transaction=<T>(actor:FleetActor,work:(state:FleetState,client:PoolClient)=>Promise<T>)=>Promise<T>;
type Permitted=(state:FleetState,actor:FleetActor,run:FleetRun,action:"view"|"dispatch")=>boolean;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function append(client:PoolClient,actor:FleetActor,target:string,id:string,value:unknown){await client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_monitoring','record',$3,$4,$5::jsonb,'completed')",[actor.userId,actor.companyId,target,id,JSON.stringify(value)]);}
export function createFleetMonitoringOperations(transaction:Transaction,permitted:Permitted,clock:()=>Date=()=>new Date(),send:typeof notifyUsers=notifyUsers){
 const manager=(state:FleetState,actor:FleetActor,fleetId:string)=>state.enabled&&!actor.readOnly&&state.grants.some(row=>row.userId===actor.userId&&row.roles.some(role=>["fleet_manager","dispatcher"].includes(role))&&row.fleetIds.includes(fleetId));
 const currentRun=(state:FleetState,actor:FleetActor,id:string)=>{const run=state.runs.find(row=>row.id===id);if(!run||!permitted(state,actor,run,"view"))throw new FleetError("fleet.not_found",404);return run;};
 const rules=async(client:PoolClient,actor:FleetActor)=>{const rows=(await client.query("SELECT user_id,tool_output FROM (SELECT DISTINCT ON(target_id) user_id,tool_output,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-monitoring-rule' ORDER BY target_id,id DESC) latest ORDER BY id DESC LIMIT 101",[actor.companyId])).rows;if(rows.length>100)throw new FleetError("fleet.monitoring_rule_limit",409);return rows.map(row=>({author:row.user_id,rule:FleetTriggerRuleSchema.parse(row.tool_output)}));};
 return {
 readFleetMonitoring:(actor:FleetActor)=>transaction(actor,async(state,client)=>({rules:(await rules(client,actor)).filter(row=>manager(state,actor,row.rule.fleetId)).map(row=>row.rule),capabilities:{phoneObservations:true,truckSafeRouting:false,hardwareTelemetry:false,eld:false,lateEtaSource:"unavailable"},checkedAt:new Date().toISOString()})),
 saveFleetTrigger:(actor:FleetActor,raw:unknown)=>transaction(actor,async(state,client)=>{
  const body=FleetTriggerSaveSchema.parse(raw);if(!manager(state,actor,body.rule.fleetId))throw new FleetError("fleet.dispatch_required",403);
  const eligible=state.grants.filter(row=>row.fleetIds.includes(body.rule.fleetId)&&row.roles.some(role=>["fleet_manager","dispatcher"].includes(role))).map(row=>row.userId);
  if(body.rule.recipientUserIds.some(id=>!eligible.includes(id)))throw new FleetError("fleet.monitoring_recipient_forbidden",403);
  const active=(await client.query("SELECT DISTINCT m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.org_type='vendor' AND m.user_id=ANY($2::int[]) AND u.suspended_at IS NULL",[actor.companyId,body.rule.recipientUserIds])).rows.map(row=>row.user_id);if(body.rule.recipientUserIds.some(id=>!active.includes(id)))throw new FleetError("fleet.monitoring_recipient_forbidden",403);
  const prior=(await client.query("SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-monitoring-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,body.operationId])).rows[0],fingerprint=hash(body);if(prior){if(prior.user_id!==actor.userId||prior.tool_output.fingerprint!==fingerprint)throw new FleetError("fleet.operation_conflict",409);return prior.tool_output.rule;}
  const list=await rules(client,actor),existing=list.find(row=>row.rule.id===body.rule.id)?.rule;if((existing?.version??0)!==body.expectedVersion||body.rule.version!==body.expectedVersion+1||existing&&existing.fleetId!==body.rule.fleetId)throw new FleetError("fleet.version_conflict",409);
  if(!existing&&list.length>=100)throw new FleetError("fleet.monitoring_rule_limit",409);
  await append(client,actor,"fleet-monitoring-rule",body.rule.id,body.rule);await append(client,actor,"fleet-monitoring-operation",body.operationId,{fingerprint,rule:body.rule});return body.rule;
 }),
 readFleetAssignmentDelivery:(actor:FleetActor,id:string)=>transaction(Object.assign(actor,{runId:id}),async(state,client)=>{
  const run=currentRun(state,actor,id),events=await readCompleteFleetRunEvents(client,run),dispatch=[...events].reverse().find(row=>row.type==="dispatch"||row.type==="reassign"),ack=[...events].reverse().find(row=>row.type==="acknowledge"&&(!dispatch||row.recordedAt>=dispatch.recordedAt)),channels:Array<{channel:"in_app"|"push"|"sms";state:"enqueued"|"provider_accepted"|"delivered"|"opened"|"acknowledged"|"failed"|"unknown"|"unavailable";at:string|null}>=[];
  if(dispatch){const rows=(await client.query("SELECT n.id,n.is_read,n.created_at,c.channel,c.status,c.delivered_at,c.updated_at FROM notifications n LEFT JOIN notification_channel_deliveries c ON c.notification_id=n.id WHERE n.dedupe_key=$1 AND ($2::boolean OR n.user_id=$3)",[`fleet:${actor.companyId}:${dispatch.operationId}`,permitted(state,actor,run,"dispatch"),actor.userId])).rows;
   for(const row of rows){channels.push({channel:"in_app",state:row.is_read?"opened":"enqueued",at:new Date(row.created_at).toISOString()});if(["sms","push"].includes(row.channel))channels.push({channel:row.channel,state:row.status==="delivered"&&row.channel==="sms"?"delivered":["sent","accepted","delivered"].includes(row.status)?"provider_accepted":["failed","undelivered"].includes(row.status)?"failed":"unknown",at:row.updated_at?new Date(row.updated_at).toISOString():null});}
   const pushes=(await client.query("SELECT p.status,p.updated_at FROM notification_push_deliveries p JOIN notifications n ON n.id=p.notification_id WHERE n.dedupe_key=$1 AND ($2::boolean OR n.user_id=$3)",[`fleet:${actor.companyId}:${dispatch.operationId}`,permitted(state,actor,run,"dispatch"),actor.userId])).rows;for(const row of pushes)channels.push({channel:"push",state:["sent","accepted","delivered"].includes(row.status)?"provider_accepted":row.status==="failed"?"failed":"unknown",at:new Date(row.updated_at).toISOString()});
  }
  for(const channel of ["in_app","push","sms"] as const)if(!channels.some(row=>row.channel===channel))channels.push({channel,state:"unavailable",at:null});
  return FleetAssignmentDeliverySchema.parse({runId:id,committedAt:dispatch?.recordedAt??null,acknowledgedAt:ack?.recordedAt??null,channels:[...new Map(channels.map(row=>[`${row.channel}:${row.state}`,row])).values()],physicalDepartureVerified:false});
 }),
 evaluateFleetRunTriggers:async(actor:FleetActor,id:string)=>{
  const pending=await transaction(Object.assign(actor,{runId:id}),async(state,client)=>{
   const run=currentRun(state,actor,id),eligible=(await rules(client,actor)).filter(row=>row.rule.fleetId===run.fleetId&&manager(state,{...actor,userId:row.author},run.fleetId)&&run.siteIds.every(site=>state.grants.find(grant=>grant.userId===row.author)?.siteIds.includes(site)&&actor.currentSiteIds?.includes(site))),events=await readCompleteFleetRunEvents(client,run),last=(type:string)=>[...events].reverse().find(row=>row.type===type)?.recordedAt??null;
   const location=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-location' AND target_id=$2 AND EXISTS(SELECT 1 FROM location_consents c WHERE c.user_id=$3 AND c.device_id=tool_output->>'deviceId' AND c.revoked_at IS NULL) ORDER BY (tool_output->'observation'->>'recordedAt')::timestamptz DESC,id DESC LIMIT 1",[actor.companyId,id,run.driverUserId])).rows[0]?.tool_output,point=FleetLocationObservationSchema.safeParse(location?.observation);
   const source=point.success&&point.data.vehicleAssetId===run.vehicleAssetId&&point.data.driverUserId===run.driverUserId?point.data:null;
   const configuration=FleetComplianceConfigurationSchema.safeParse((await client.query("SELECT fleet_compliance_configuration FROM vendors WHERE id=$1",[actor.companyId])).rows[0]?.fleet_compliance_configuration??{}),assets=new Set([run.vehicleAssetId,...(run.resourceAssignment?.snapshot.rigPackage?.components.map(row=>row.assetId)??[])]);
   const dates=configuration.success?configuration.data.entries.filter(entry=>entry.validUntil&&(entry.subject.kind==="carrier"&&entry.subject.id===actor.companyId||entry.subject.kind==="driver"&&entry.subject.id===run.driverUserId||["vehicle","component"].includes(entry.subject.kind)&&assets.has(String(entry.subject.id)))).map(entry=>entry.validUntil!).sort():[];
   const previous=(await client.query("SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-monitoring-event' AND tool_output->>'runId'=$2 ORDER BY target_id,id DESC) latest",[actor.companyId,id])).rows.map(row=>row.tool_output);
   const context={id,fleetId:run.fleetId,siteIds:run.siteIds,status:run.status,currentStopId:run.currentStopId,dispatchedAt:last("dispatch"),acknowledgedAt:last("acknowledge"),stopArrivedAt:run.currentStopId?last("arrive_stop"):null,positionAt:source?.recordedAt??null,etaAt:null,plannedArrivalAt:run.schedule?.plannedEndAt??null,credentialDueAt:dates[0]??null},now=clock().toISOString();
   const active=(await client.query("SELECT DISTINCT m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.org_type='vendor' AND u.suspended_at IS NULL AND (m.role IN ('admin','member') OR (m.role='field_employee' AND EXISTS(SELECT 1 FROM vendor_people p WHERE p.user_id=m.user_id AND p.vendor_id=m.vendor_id AND p.is_active=true AND p.deleted_at IS NULL)))",[actor.companyId])).rows.map(row=>row.user_id);
   const liveRules=eligible.filter(row=>active.includes(row.author)).map(row=>({...row.rule,recipientUserIds:row.rule.recipientUserIds.filter(id=>active.includes(id)&&state.grants.some(grant=>grant.userId===id&&grant.fleetIds.includes(run.fleetId)&&grant.roles.some(role=>["fleet_manager","dispatcher"].includes(role))&&run.siteIds.every(site=>grant.siteIds.includes(site))))}));
   const permittedRules=liveRules.filter(row=>row.recipientUserIds.length),triggered=evaluateFleetTriggers({runs:[context],previous},permittedRules,now);
   for(const event of triggered)await append(client,actor,"fleet-monitoring-event",`${event.ruleId}:${id}`,event);
   // A committed threshold and a queued notification are different facts.
   // Retry a still-relevant occurrence inside cooldown, using the same dedupe
   // key and actual notification rows as durable per-recipient acknowledgement.
   const activeConditions=evaluateFleetTriggers({runs:[context],previous:[]},permittedRules,now),latest=new Map<string,FleetTriggerEvent>();
   for(const event of [...previous,...triggered])latest.set(event.ruleId,event);
   const notices:FleetTriggerEvent[]=[];
   for(const event of latest.values()){
    const condition=activeConditions.find(candidate=>candidate.ruleId===event.ruleId&&candidate.ruleVersion===event.ruleVersion&&candidate.sourceAt===event.sourceAt);if(!condition)continue;
    const recipients=event.recipientUserIds.filter(userId=>condition.recipientUserIds.includes(userId)),key=`fleet-trigger:${actor.companyId}:${event.ruleId}:${event.runId}:${event.at}`;
    const recorded=(await client.query("SELECT user_id FROM notifications WHERE dedupe_key=$1 AND user_id=ANY($2::int[])",[key,recipients])).rows.map(row=>row.user_id);
    const missing=recipients.filter(userId=>!recorded.includes(userId));if(missing.length)notices.push({...event,recipientUserIds:missing});
   }
   return {triggered,notices};
  });
  for(const event of pending.notices)try{await send(event.recipientUserIds,{type:"fleet_monitoring",category:"crew",title:`Fleet attention: ${event.kind.replaceAll("_"," ")}`,body:"A saved monitoring threshold was reached. Open the run to review actual source times and current status.",link:`/fleet/runs/${event.runId}`,dedupeKey:`fleet-trigger:${actor.companyId}:${event.ruleId}:${event.runId}:${event.at}`});}catch{/* Original event remains durable; a later scan retries the same dedupe key. */}
  return {events:pending.triggered,checkedAt:new Date().toISOString()};
 }
 };
}
/** Saved rule author is rechecked against current database membership/grants.
 * No browser session, arbitrary assistant identity or physical report is invented. */
export async function scanFleetMonitoring(){
 const {fleetCommercialCompanyIds,isFleetCommercialWorkEnabled}=await import("./fleet-commercial-activation");
 if(process.env.FLEET_COMMERCIAL_WORK_V2!=="1"&&!fleetCommercialCompanyIds().length)return;
 const companies=(await pool.query("SELECT DISTINCT vendor_id FROM assistant_action_audit WHERE target_type='fleet-monitoring-rule' ORDER BY vendor_id")).rows;
 const {createFleetService}=await import("./fleet-ops"),{databaseFleetRepository}=await import("./fleet-repository");
 for(const company of companies){if(!isFleetCommercialWorkEnabled(company.vendor_id))continue;const authors=(await pool.query("SELECT DISTINCT a.user_id,m.id AS membership_id,m.role AS membership_role,CASE WHEN m.role='field_employee' THEN 'field_employee' ELSE 'vendor' END AS role,u.session_version,p.id AS person_id FROM assistant_action_audit a JOIN user_org_memberships m ON m.user_id=a.user_id AND m.org_type='vendor' AND m.vendor_id=a.vendor_id JOIN users u ON u.id=a.user_id AND u.suspended_at IS NULL LEFT JOIN vendor_people p ON p.user_id=u.id AND p.vendor_id=a.vendor_id AND p.is_active=true AND p.deleted_at IS NULL WHERE a.vendor_id=$1 AND a.target_type='fleet-monitoring-rule' ",[company.vendor_id])).rows;for(const author of authors){
  const actor:FleetActor={userId:author.user_id,companyId:company.vendor_id,activeMembershipId:author.membership_id,membershipRole:author.membership_role,role:author.role,sv:author.session_version,vendorPeopleId:author.person_id},service=createFleetService(databaseFleetRepository);let after=0;
  for(;;){const rows=(await pool.query("SELECT target_id,id FROM (SELECT DISTINCT ON(target_id) target_id,id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' ORDER BY target_id,id DESC) latest WHERE id>$2 AND tool_output->>'status'=ANY($3::text[]) ORDER BY id LIMIT 50",[actor.companyId,after,["dispatched","acknowledged","in_progress"]])).rows;if(!rows.length)break;for(const row of rows){after=Number(row.id);try{await service.evaluateFleetRunTriggers({...actor},row.target_id);}catch{/* No permission means no disclosure/notice. Next independent run continues. */}}}
 }}
}
let timer:ReturnType<typeof setInterval>|undefined,busy=false;
export function startFleetMonitoringWorker(){if(timer)return;timer=setInterval(()=>{if(busy)return;busy=true;void scanFleetMonitoring().catch(()=>undefined).finally(()=>{busy=false;});},60000);timer.unref();}
export function stopFleetMonitoringWorker(){if(timer)clearInterval(timer);timer=undefined;}
