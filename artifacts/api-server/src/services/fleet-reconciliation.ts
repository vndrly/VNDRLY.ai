import {z} from "zod/v4";
import {FleetRunSchema,FleetRecoveryOptionsSchema,FleetReconciliationCaseSchema,FleetReconciliationPageSchema,FleetWorkReceiptSchema,FleetWorkCommandSchema,FleetWorkMappingSchema,fleetDetailSnapshotIdentityMatches,type FleetWorkCommand,type FleetReconciliationCase,type FleetWorkScope} from "@workspace/api-zod";
import type {FleetWorkExecution} from "./fleet-work";
import {isDeepStrictEqual} from "node:util";
import type {FleetWorkExecutionContext} from "./fleet-work-repository";
import {readFleetWorkOriginal} from "./fleet-work-originals";
import {FleetError} from "./fleet-repository";
import {createFleetWorkCanonicalService} from "./fleet-work-canonical";
import {resolveFleetWorkReference} from "./fleet-work-references";
import {readFleetWorkBillingChoices} from "./fleet-work-preparation";
import {adoptFleetPerformedSources} from "./fleet-performed-sources";
import {readFleetOriginalBilling} from "./fleet-recovery-billing";

export async function authorizeFleetRecovery(context:FleetWorkExecutionContext,value:FleetReconciliationCase,original:FleetWorkCommand){
 const {actor,state}=context,grant=state.grants.find(row=>row.userId===actor.userId);
 if(!state.enabled||!grant||value.scope.owner.type!=="vendor"||value.scope.owner.id!==actor.companyId||!isDeepStrictEqual(value.scope,original.scope)||value.operationId!==original.operationId)throw new FleetError("fleet.recovery_forbidden",403);
 const office=grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher");
 if(actor.userId!==value.scope.userId&&!office)throw new FleetError("fleet.recovery_forbidden",403);
 if(original.kind==="activity.create"){
  const detail=original.payload.detailSnapshot.detail,site=original.payload.billing.billingSiteId;
  if(!detail.accessGroupIds.some(id=>grant.fleetIds.includes(id))||(office&&(!site||!grant.siteIds.includes(site)))||(!office&&detail.driverUserId!==actor.userId))throw new FleetError("fleet.recovery_forbidden",403);
 }else if("activity" in original.payload&&original.payload.activity.type==="canonical"){
  const authority={...actor,runId:String(original.payload.activity.id)};
  const saved=(await context.client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,original.payload.activity.id])).rows[0];
  if(!saved)throw new FleetError("fleet.recovery_forbidden",403);
  const activityId=original.payload.activity.id;
  if(!state.runs.some(run=>run.id===activityId))state.runs.push(FleetRunSchema.parse(saved.tool_output));
  await createFleetWorkCanonicalService(context).detail(authority,String(original.payload.activity.id));
 }else if(actor.userId!==value.scope.userId)throw new FleetError("fleet.recovery_forbidden",403);
 return {office,canResolve:office&&!actor.readOnly};
}
const querySchema=z.object({after:z.string().regex(/^[1-9]\d{0,17}$/).optional(),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
export async function readFleetRecoveryOptions(context:FleetWorkExecutionContext,id:string,after?:string){
 const row=(await context.client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-case' AND target_id=$2 ORDER BY id DESC LIMIT 1",[context.actor.companyId,z.uuid().parse(id)])).rows[0];if(!row)throw new FleetError("fleet.recovery_forbidden",403);
 const value=FleetReconciliationCaseSchema.parse(row.tool_output),original=await readFleetWorkOriginal(context.client,context.actor.companyId,value.operationId),permission=await authorizeFleetRecovery(context,value,original.command);
 if(!permission.canResolve||value.resolution)throw new FleetError("fleet.recovery_forbidden",403);
 const source=await readFleetOriginalBilling(context,original.command);if(!source)throw new FleetError("fleet.recovery_requires_source_review",409);
 const grant=context.state.grants.find(row=>row.userId===context.actor.userId)!,fleetId=source.fleetId??(original.command.kind==="activity.create"?original.command.payload.detailSnapshot.detail.accessGroupIds.find(id=>grant.fleetIds.includes(id)):undefined);
 if(!fleetId||!grant.fleetIds.includes(fleetId)||!source.billing.billingSiteId||!grant.siteIds.includes(source.billing.billingSiteId))throw new FleetError("fleet.recovery_forbidden",403);
 const service=createFleetWorkCanonicalService(context),billing=await readFleetWorkBillingChoices(context,{fleetId,siteId:source.billing.billingSiteId,afeNumber:source.billing.afeNumber,workDate:source.billing.workDate}),details=original.command.kind==="activity.create"?await service.readFleetDetails({...context.actor},{limit:50,...(after?{after:z.uuid().parse(after)}:{})}):{details:[],nextCursor:null};
 return FleetRecoveryOptionsSchema.parse({tickets:billing.tickets.map(ticket=>({id:ticket.id,ticketNumber:String(ticket.ticketNumber),version:ticket.planVersion})),services:billing.workTypes.map(work=>({id:work.id,name:work.name})),details:details.details.map(detail=>({id:detail.id,version:detail.version,name:detail.name,driverUserId:detail.driverUserId})),nextDetailCursor:details.nextCursor});
}
export async function readFleetReconciliation(context:FleetWorkExecutionContext,raw:unknown){
 const {actor,state,client}=context,input=querySchema.parse(raw),grant=state.grants.find(row=>row.userId===actor.userId);
 if(!state.enabled||!grant)throw new FleetError("fleet.recovery_forbidden",403);
 const office=grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher");
 const rows=(await client.query("SELECT id,tool_output FROM (SELECT DISTINCT ON(target_id) id,user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-case' AND ($2::boolean OR user_id=$3) ORDER BY target_id,id DESC) latest WHERE id>$4::bigint ORDER BY id LIMIT $5",[actor.companyId,office,actor.userId,input.after??"0",input.limit+1])).rows;
 const included=rows.slice(0,input.limit),cases=[];
 for(const row of included){
  const value=FleetReconciliationCaseSchema.parse(row.tool_output);
  if(value.scope.userId!==actor.userId&&!value.originalReferences.some(ref=>ref.kind==="activity"))continue;
  const original=await readFleetWorkOriginal(client,actor.companyId,value.operationId);
  try{const permission=await authorizeFleetRecovery(context,value,original.command),{scope:_,...safe}=value,command=original.command,source=permission.office?await readFleetOriginalBilling(context,command):null;cases.push({case:(command.kind==="activity.create"||command.kind==="activity.action"&&command.payload.activity.type==="canonical")&&!value.resolution?{...safe,allowedResolutions:[...new Set([...safe.allowedResolutions,"adopt_performed" as const])]}:safe,original:{kind:command.kind,capturedAt:command.capturedAt,timeZone:command.timeZone,title:source?.title??(command.kind==="activity.create"?command.payload.title:null),driverUserId:source?.driverUserId??(command.kind==="activity.create"?command.payload.detailSnapshot.detail.driverUserId:null),activity:command.kind==="activity.create"?{type:"local",kind:"activity",id:command.payload.activityId}:"activity" in command.payload?command.payload.activity:null,ticket:command.kind==="activity.create"?command.payload.billing.ticket:"ticket" in command.payload&&command.kind!=="activity.legacy_action"?command.payload.ticket:null,billing:source?.billing??(command.kind==="activity.create"?command.payload.billing:null)},canResolve:permission.canResolve&&!value.resolution,canReviewSources:permission.office});}
  catch(error){if(error instanceof FleetError&&error.status===403)continue;throw error;}
 }
 return FleetReconciliationPageSchema.parse({cases,nextCursor:rows.length>input.limit?String(included.at(-1)!.id):null});
}
async function append(context:FleetWorkExecutionContext,type:string,id:string,value:unknown,userId=context.actor.userId){await context.client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_recovery','explicit-office-resolution',$3,$4,$5::jsonb,'completed')",[userId,context.actor.companyId,type,id,JSON.stringify(value)]);}
async function mapOriginal(context:FleetWorkExecutionContext,scope:FleetWorkScope,raw:unknown){
 const mapping=FleetWorkMappingSchema.parse(raw),id=`${scope.provisioningId}:${mapping.local.kind}:${mapping.local.id}`;
 const prior=(await context.client.query("SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-mapping' AND target_id=$2 ORDER BY id DESC LIMIT 1",[context.actor.companyId,id])).rows[0];
 if(prior){if(prior.user_id!==scope.userId||!isDeepStrictEqual(prior.tool_output,{scope,mapping}))throw new FleetError("fleet.work_mapping_conflict",409);return;}
 await append(context,"fleet-work-mapping",id,{scope,mapping},scope.userId);
}
/** Resolution adopts an immutable original through current office authority;
 * it never reopens a ticket, dispatches, or fabricates a driver's next step. */
export async function resolveFleetReconciliation(context:FleetWorkExecutionContext,command:Extract<FleetWorkCommand,{kind:"activity.reconcile"}>,execute:(command:FleetWorkCommand)=>Promise<FleetWorkExecution>):Promise<FleetWorkExecution>{
 const {actor,client}=context,p=command.payload,row=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-case' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,p.caseId])).rows[0];
 if(!row)throw new FleetError("fleet.recovery_forbidden",403);
 const value=FleetReconciliationCaseSchema.parse(row.tool_output),original=await readFleetWorkOriginal(client,actor.companyId,value.operationId),permission=await authorizeFleetRecovery(context,value,original.command);
 if(!permission.canResolve)throw new FleetError("fleet.recovery_forbidden",403);
 if(value.resolution||value.version!==p.expectedVersion)throw new FleetError("fleet.case_version_conflict",409);
 if(!value.allowedResolutions.includes(p.resolution.kind)&&!(p.resolution.kind==="adopt_performed"&&(original.command.kind==="activity.create"||original.command.kind==="activity.action"&&original.command.payload.activity.type==="canonical")))throw new FleetError("fleet.case_resolution_forbidden",409);
 const record=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,value.operationId])).rows[0];
 if(!record||record.tool_output.fingerprint!==original.fingerprint||!isDeepStrictEqual(record.tool_output.scope,value.scope))throw new FleetError("fleet.original_storage_unavailable",503);
 let result:FleetWorkExecution={canonicalReferences:[],mappings:[]};
 if(p.resolution.kind==="adopt_performed"){
  result=await adoptFleetPerformedSources(context,command);
 }else if(p.resolution.kind==="retain_record_only"){
  const receipt=FleetWorkReceiptSchema.parse({version:2,operationId:value.operationId,scope:value.scope,fingerprint:original.fingerprint,recordedAt:new Date().toISOString(),status:"retained",reason:value.reason,caseId:value.id,resolution:{caseId:value.id,officeOperationId:command.operationId,reviewedByUserId:actor.userId,reason:p.reason}});
  await append(context,"fleet-work-resolution-receipt",value.operationId,receipt,value.scope.userId);
 }else if(p.resolution.kind==="resolve_price"&&original.command.kind==="price.resolve"){
  if(!isDeepStrictEqual(p.activity,original.command.payload.activity)||!isDeepStrictEqual(p.originalTicket,original.command.payload.ticket))throw new FleetError("fleet.original_identity_conflict",409);
  // This reauthorizes only the retained OFFICE pricing request. The canonical
  // resolver reads actual partner-approved terms; no driver action is replayed.
  result=await execute(FleetWorkCommandSchema.parse({...original.command,operationId:command.operationId,scope:command.scope}));
  if(p.resolution.pricingIntent){const reference=result.canonicalReferences.find(ref=>ref.kind==="activity"),run=context.state.runs.find(run=>run.id===reference?.id);if(!isDeepStrictEqual(run?.billingV2?.pricing,p.resolution.pricingIntent))throw new FleetError("fleet.price_authority_unresolved",409);}
  const receipt=FleetWorkReceiptSchema.parse({version:2,operationId:value.operationId,scope:value.scope,fingerprint:original.fingerprint,recordedAt:new Date().toISOString(),status:"applied",mappings:result.mappings,canonicalReferences:result.canonicalReferences,resolution:{caseId:value.id,officeOperationId:command.operationId,reviewedByUserId:actor.userId,reason:p.reason}});
  await append(context,"fleet-work-resolution-receipt",value.operationId,receipt,value.scope.userId);
 }else{
  if(original.command.kind!=="activity.create")throw new FleetError("fleet.recovery_requires_source_review",409);
  const source=structuredClone(original.command),payload=source.payload;
  if(p.activity.type!=="local"||p.activity.id!==payload.activityId||!isDeepStrictEqual(p.originalTicket,payload.billing.ticket))throw new FleetError("fleet.original_identity_conflict",409);
  if(p.resolution.kind==="correct_assignment"){
   const reference=await resolveFleetWorkReference(context,command.scope,p.resolution.detailReference);
   if(reference.kind!=="detail"||typeof reference.id!=="string")throw new FleetError("fleet.invalid_request",400);
   const current=await createFleetWorkCanonicalService(context).fleetDetailSnapshot({...actor},reference.id);
   if(!fleetDetailSnapshotIdentityMatches(current,p.resolution.snapshot))throw new FleetError("fleet.work_assignment_changed",409);
   payload.detailReference=reference;payload.detailSnapshot=p.resolution.snapshot;
  }else if(p.resolution.kind==="link_open_ticket")payload.billing={...payload.billing,choice:"existing_ticket",ticket:p.resolution.ticket};
  else if(p.resolution.kind==="create_ticket")payload.billing=p.resolution.billing;
  else if(p.resolution.kind==="resolve_location"){
   const directory=await createFleetWorkCanonicalService(context).commercialSettings({...actor},payload.billing.billingSiteId!);
   const canonical=p.resolution.canonical;if(canonical.type!=="canonical"||canonical.kind!=="location"||!directory.destinations.some(location=>location.id===canonical.id&&location.revision===canonical.version))throw new FleetError("fleet.route_location_unresolved",409);
   const mapping={local:p.resolution.original,canonical};await mapOriginal(context,value.scope,mapping);await mapOriginal(context,command.scope,mapping);
  }else throw new FleetError("fleet.case_resolution_forbidden",409);
  if(p.recoveryDriverUserId!==payload.detailSnapshot.detail.driverUserId)throw new FleetError("fleet.work_scheduling_context_required",409);
  // A changed billing reference is explicit and audited. Physical actions in
  // subsequent originals still require their own actual assignment proof.
  const adopted=FleetWorkCommandSchema.parse({...source,operationId:command.operationId,scope:command.scope,payload});
  result=await execute(adopted);
  const activity=result.canonicalReferences.find(ref=>ref.kind==="activity"),ticket=result.canonicalReferences.find(ref=>ref.kind==="ticket");
  const originalMappings=[];
  if(activity)originalMappings.push(FleetWorkMappingSchema.parse({local:{type:"local",kind:"activity",id:original.command.payload.activityId},canonical:activity}));
  if(ticket&&original.command.payload.billing.ticket.type==="local")originalMappings.push(FleetWorkMappingSchema.parse({local:original.command.payload.billing.ticket,canonical:ticket}));
  for(const mapping of originalMappings)await mapOriginal(context,value.scope,mapping);
  const receipt=FleetWorkReceiptSchema.parse({version:2,operationId:value.operationId,scope:value.scope,fingerprint:original.fingerprint,recordedAt:new Date().toISOString(),status:"applied",mappings:originalMappings,canonicalReferences:result.canonicalReferences,resolution:{caseId:value.id,officeOperationId:command.operationId,reviewedByUserId:actor.userId,reason:p.reason}});
  await append(context,"fleet-work-resolution-receipt",value.operationId,receipt,value.scope.userId);
 }
 const resolution={kind:p.resolution.kind,operationId:command.operationId,reviewedByUserId:actor.userId,reviewedAt:new Date().toISOString(),reason:p.reason,canonicalReferences:result.canonicalReferences};
 await append(context,"fleet-work-case",value.id,FleetReconciliationCaseSchema.parse({...value,version:value.version+1,resolution}));
 return result;
}
