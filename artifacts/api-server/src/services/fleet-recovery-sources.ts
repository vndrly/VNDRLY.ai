import {z} from "zod/v4";
import {isDeepStrictEqual} from "node:util";
import {createHash} from "node:crypto";
import {FleetReconciliationCaseSchema,FleetRunSchema,FleetDetailSchema,FleetRigPackageSchema,FleetRecoverySourcePageSchema,fleetDetailSnapshotIdentityMatches,type FleetWorkCommand,type FleetWorkReference,type FleetDetailSnapshot} from "@workspace/api-zod";
import type {FleetWorkExecutionContext} from "./fleet-work-repository";
import {readFleetWorkOriginal} from "./fleet-work-originals";
import {authorizeFleetRecovery} from "./fleet-reconciliation";
import {readFleetResourceRecord} from "./fleet-resource-store";
import {FleetError} from "./fleet-repository";
import {FleetRecoverySourcePlanSchema,qualifyFleetOriginalReports,createFleetWorkState,appendFleetWorkIntent,projectFleetLocalActivities,type FleetRun,type FleetOriginalReport} from "@workspace/api-zod";
import {readFleetServiceTemplate} from "./fleet-service-template";
import {FleetWorkReceiptSchema} from "@workspace/api-zod";
import {readCompleteFleetRunEvents} from "./fleet-run-events";
import {fleetOriginalBillingIntent} from "./fleet-recovery-billing";
const querySchema=z.object({cursor:z.string().regex(/^\d{1,18}:\d{1,18}$/).optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
function activity(command:FleetWorkCommand):FleetWorkReference|null{return command.kind==="activity.create"?{type:"local",kind:"activity",id:command.payload.activityId}:"activity" in command.payload?command.payload.activity:null;}
const sameIdentity=(a:FleetWorkReference|null,b:FleetWorkReference|null)=>!!a&&!!b&&a.type===b.type&&a.kind===b.kind&&a.id===b.id;
/** Only allowlisted operational summaries leave private original storage.
 * This reads historical sources; it cannot replay a driver or reserve today's Detail. */
async function recoveryContext(context:FleetWorkExecutionContext,caseId:string){
 const {client,actor}=context,row=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-case' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,z.uuid().parse(caseId)])).rows[0];
 if(!row)throw new FleetError("fleet.recovery_forbidden",403);
 const value=FleetReconciliationCaseSchema.parse(row.tool_output),original=await readFleetWorkOriginal(client,actor.companyId,value.operationId),permission=await authorizeFleetRecovery(context,value,original.command);
 if(!permission.office)throw new FleetError("fleet.recovery_forbidden",403);
 const reference=activity(original.command);if(!reference)throw new FleetError("fleet.recovery_requires_source_review",409);
 let snapshot:FleetDetailSnapshot,baseRun:FleetRun|undefined;
 if(original.command.kind==="activity.create"){
  snapshot=original.command.payload.detailSnapshot;
  const detail=FleetDetailSchema.parse(await readFleetResourceRecord(client,actor.companyId,"fleet-detail",snapshot.detail.id,snapshot.detail.version));
  const rig=snapshot.rigPackage?FleetRigPackageSchema.parse(await readFleetResourceRecord(client,actor.companyId,"fleet-rig-package",snapshot.rigPackage.id,snapshot.rigPackage.version)):null;
  if(!isDeepStrictEqual(detail,snapshot.detail)||!isDeepStrictEqual(rig,snapshot.rigPackage)||detail.companyId!==actor.companyId)throw new FleetError("fleet.original_assignment_unverified",409);
 }else{
  if(reference.type!=="canonical")throw new FleetError("fleet.original_assignment_unverified",409);
  const saved=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 AND tool_output->>'version'=$3 ORDER BY id DESC LIMIT 1",[actor.companyId,reference.id,String(reference.version)])).rows[0];
  if(!saved)throw new FleetError("fleet.original_assignment_unverified",409);
  const run=FleetRunSchema.parse(saved.tool_output);if(!run.resourceAssignment||run.companyId!==actor.companyId)throw new FleetError("fleet.original_assignment_unverified",409);snapshot=run.resourceAssignment.snapshot;baseRun=run;
  if("baseAssignment" in original.command.payload&&!fleetDetailSnapshotIdentityMatches(snapshot,original.command.payload.baseAssignment))throw new FleetError("fleet.original_assignment_unverified",409);
 }
 return {value,original,reference,snapshot,baseRun};
}
export async function readFleetRecoverySources(context:FleetWorkExecutionContext,caseId:string,raw:unknown){
 const {client,actor}=context,input=querySchema.parse(raw),{value,reference,snapshot}=await recoveryContext(context,caseId);
 const owner=`fleet-work-original:${actor.companyId}:${value.scope.userId}:${value.scope.provisioningId}`,parts=input.cursor?.split(":");
 const after=parts?.[0]??"0",ceiling=parts?.[1]??String((await client.query("SELECT COALESCE(MAX(id),0) AS id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-original' AND tool_output->>'owner'=$2",[actor.companyId,owner])).rows[0].id);
 if(BigInt(after)>BigInt(ceiling))throw new FleetError("fleet.invalid_cursor",400);
 const candidates=(await client.query("SELECT id,created_at,target_id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-original' AND tool_output->>'owner'=$2 AND id>$3::bigint AND id<=$4::bigint ORDER BY id LIMIT $5",[actor.companyId,owner,after,ceiling,input.limit+1])).rows;
 const included=candidates.slice(0,input.limit),sources=[];
 for(const candidate of included){
  const retained=await readFleetWorkOriginal(client,actor.companyId,candidate.target_id),command=retained.command;
  if(!isDeepStrictEqual(command.scope,value.scope))throw new FleetError("fleet.original_identity_conflict",409);
  if(!sameIdentity(activity(command),reference))continue;
  const action=command.kind==="activity.action"?command.payload.action:null,quantity=command.kind==="quantity.record"?command.payload.evidence:null,evidence=command.kind==="evidence.stage"?command.payload:null;
  const assignment="baseAssignment" in command.payload?command.payload.baseAssignment:command.kind==="evidence.stage"?command.payload.assignment:command.kind==="activity.create"?command.payload.detailSnapshot:null;
  sources.push({operationId:command.operationId,fingerprint:retained.fingerprint,kind:command.kind,reportedByUserId:command.scope.userId,driverReport:command.scope.userId===snapshot.detail.driverUserId,assignmentMatches:assignment?fleetDetailSnapshotIdentityMatches(snapshot,assignment):true,capturedAt:command.capturedAt,receivedAt:new Date(candidate.created_at).toISOString(),timeZone:command.timeZone,action:action?.action??null,expectedVersion:action?.expectedVersion??null,notes:command.kind==="activity.note"?command.payload.notes:action?.notes??null,quantity:quantity?.quantity??(action?.quantity!==undefined?String(action.quantity):null),unit:quantity?.unit??action?.unit??null,reading:action?.reading??null,commodity:action?.commodity??null,inspectionOutcome:action?.inspectionOutcome??null,evidence:evidence?{kind:evidence.kind,byteSize:evidence.byteSize,sha256:evidence.sha256,contentType:evidence.contentType}:null});
 }
 return FleetRecoverySourcePageSchema.parse({caseId:value.id,caseVersion:value.version,source:"retained_original_reports",canonicalApplied:false,historicalDetailVerified:true,detail:{id:snapshot.detail.id,name:snapshot.detail.name,version:snapshot.detail.version,driverUserId:snapshot.detail.driverUserId,vehicleAssetId:snapshot.detail.vehicleAssetId,rigPackageId:snapshot.rigPackage?.id??null,componentAssetIds:snapshot.rigPackage?.components.map(c=>c.assetId)??[]},sources,scannedCount:included.length,nextCursor:candidates.length>input.limit?`${included.at(-1)!.id}:${ceiling}`:null});
}

/** A server-prepared historical source packet. Reads every retained source in
 * bounded private pages; it does NOT apply physical actions, create charges,
 * reserve equipment or trust the current replacement assignment. */
export async function prepareFleetRecoverySourcePlan(context:FleetWorkExecutionContext,caseId:string){
 const {client,actor}=context,{value,original,reference,snapshot,baseRun}=await recoveryContext(context,caseId),root=original.command;
 let base=baseRun,ticket="ticket" in root.payload?root.payload.ticket:null;
 if(root.kind==="activity.create"){
  if(root.payload.serviceTemplate){const saved=await readFleetServiceTemplate(client,actor.companyId,root.payload.serviceTemplate.serviceId,root.payload.serviceTemplate.revision);if(!saved||!isDeepStrictEqual(saved,root.payload.serviceTemplate))throw new FleetError("fleet.template_revision_conflict",409);}
  const projection=structuredClone(root);
  if(!projection.payload.originStopId){const h=createHash("sha256").update(`${root.operationId}:origin`).digest("hex");projection.payload.originStopId=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
  const pending=appendFleetWorkIntent(createFleetWorkState(root.scope),projection,original.fingerprint);
  // No current group profile is substituted for historical captured settings.
  base=projectFleetLocalActivities(pending.entries,root.scope.userId,[])[0];ticket=root.payload.billing.ticket;
  if(base&&root.payload.dispatchAfterCreate){base.status="dispatched";base.version=2;base.allowedActions=[];}
 }
 if(!base||!ticket||!("type" in ticket))throw new FleetError("fleet.recovery_requires_source_review",409);
 const owner=`fleet-work-original:${actor.companyId}:${value.scope.userId}:${value.scope.provisioningId}`,ceiling=String((await client.query("SELECT COALESCE(MAX(id),0) AS id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-original' AND tool_output->>'owner'=$2",[actor.companyId,owner])).rows[0].id);
 let after="0";const sources:FleetOriginalReport[]=[];
 for(;;){
  const rows=(await client.query("SELECT id,created_at,target_id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-original' AND tool_output->>'owner'=$2 AND id>$3::bigint AND id<=$4::bigint ORDER BY id LIMIT 100",[actor.companyId,owner,after,ceiling])).rows;
  for(const row of rows){const retained=await readFleetWorkOriginal(client,actor.companyId,row.target_id);if(!isDeepStrictEqual(retained.command.scope,value.scope))throw new FleetError("fleet.original_identity_conflict",409);if(sameIdentity(activity(retained.command),reference))sources.push({command:retained.command,fingerprint:retained.fingerprint,receivedAt:new Date(row.created_at).toISOString()});}
  if(rows.length<100)break;const next=String(rows.at(-1)!.id);if(BigInt(next)<=BigInt(after))throw new FleetError("fleet.original_storage_unavailable",503);after=next;
 }
 const canonicalSources:FleetOriginalReport[]=[],pendingSources:FleetOriginalReport[]=[],baseEvents=baseRun?await readCompleteFleetRunEvents(client,baseRun):[];
 for(const source of sources){
  const c=source.command;
  if(baseRun&&c.kind==="activity.action"&&c.payload.action.expectedVersion<baseRun.version){
   const row=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type IN ('fleet-work-operation','fleet-work-resolution-receipt') AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,c.operationId])).rows[0];
   const receipt=row?FleetWorkReceiptSchema.parse(row.tool_output):undefined,event=baseEvents.find(e=>e.operationId===c.operationId&&e.type===c.payload.action.action&&e.actorUserId===c.scope.userId);
   if(!receipt||!["applied","duplicate"].includes(receipt.status)||receipt.fingerprint!==source.fingerprint||!isDeepStrictEqual(receipt.scope,c.scope)||!("canonicalReferences" in receipt)||!receipt.canonicalReferences.some(r=>r.kind==="activity"&&r.id===baseRun.id&&r.version>c.payload.action.expectedVersion&&r.version<=baseRun.version)||!event||(event.capturedAt&&Date.parse(event.capturedAt)!==Date.parse(c.capturedAt)))throw new FleetError("fleet.original_prefix_unverified",409);
   canonicalSources.push(source);
  }else pendingSources.push(source);
 }
 const qualification=qualifyFleetOriginalReports({run:base,snapshot,scope:value.scope,activity:reference,ticket,sources:pendingSources});
 const fingerprint=createHash("sha256").update(JSON.stringify({caseId:value.id,caseVersion:value.version,original:original.fingerprint,baseVersion:base.version,snapshot,sources:sources.map(s=>({operationId:s.command.operationId,fingerprint:s.fingerprint,receivedAt:s.receivedAt})).sort((a,b)=>a.operationId.localeCompare(b.operationId))})).digest("hex");
 const plan=FleetRecoverySourcePlanSchema.parse({caseId:value.id,caseVersion:value.version,source:"retained_original_reports",canonicalApplied:false,physicalProofVerified:false,fingerprint,sourceCount:pendingSources.length,canonicalSourceCount:canonicalSources.length,status:qualification.status,reasons:qualification.reasons,originalDriverUserId:qualification.originalDriverUserId,reportedClosedAt:qualification.reportedClosedAt});
 const billingIntent=fleetOriginalBillingIntent(root,base),pricingIntent=root.kind==="activity.create"?root.payload.pricingIntent:base.billingV2!.pricing,workAt=root.kind==="activity.create"?root.capturedAt:baseEvents[0]?.capturedAt??baseEvents[0]?.recordedAt;
 if(!workAt)throw new FleetError("fleet.original_assignment_unverified",409);
 return {plan,qualification,base,snapshot,original,sources:pendingSources,canonicalSources,value,billingIntent,pricingIntent,workAt,reference,ticket};
}
export async function readFleetRecoverySourcePlan(context:FleetWorkExecutionContext,caseId:string){return (await prepareFleetRecoverySourcePlan(context,caseId)).plan;}
