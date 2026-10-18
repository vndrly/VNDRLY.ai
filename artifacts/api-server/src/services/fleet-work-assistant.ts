import {createHash,randomUUID} from "node:crypto";
import {z} from "zod/v4";
import {FleetRunSchema,FleetWorkCommandSchema,CreateFleetRunSchema,buildFleetCreateIntent,buildFleetActionIntent,FleetWorkScopeSchema,FleetWorkReceiptSchema} from "@workspace/api-zod";
import {FLEET_COMMERCIAL_DEFINITIONS} from "../assistant/fleet-commercial-tools";
import {createDatabaseFleetWorkRepository} from "./fleet-work-repository";
import {executeFleetWorkCommand,createFleetWorkCanonicalService} from "./fleet-work-canonical";
import {createFleetWorkService} from "./fleet-work";
import {prepareFleetWorkCreation} from "./fleet-work-preparation";
import {retainFleetWorkOriginal,readFleetWorkOriginal} from "./fleet-work-originals";
import {FleetError,databaseFleetRepository} from "./fleet-repository";
import type {FleetActor} from "./fleet-ops";
import {readFleetCommercialReview} from "./fleet-commercial-review";
import {readFleetReconciliation,readFleetRecoveryOptions} from "./fleet-reconciliation";
import {readFleetRecoverySources,readFleetRecoverySourcePlan} from "./fleet-recovery-sources";
const repository=createDatabaseFleetWorkRepository({execute:executeFleetWorkCommand}),service=createFleetWorkService(repository);
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,ordered(value)])):value;
/** Logical assistant channel has no physical-device/location capability. The
 * trusted session supplies all scope; the confirmed request gets one private
 * immutable original before canonical apply. A response-loss retry cannot
 * regenerate a timestamp, Detail revision, ticket or business fingerprint. */
export async function applyFleetAssistantIntent(actor:FleetActor,raw:unknown){
 const envelope=z.object({kind:z.string(),operationId:z.uuid()}).passthrough().parse(raw),definition=FLEET_COMMERCIAL_DEFINITIONS.find(row=>row.kind===envelope.kind);
 if(!definition)throw new FleetError("fleet.invalid_request",400);
 const {kind,operationId,...business}=envelope,input=definition.schema.parse(business) as Record<string,any>;
 const requestFingerprint=createHash("sha256").update(JSON.stringify(ordered({kind,input}))).digest("hex"),provision=await repository.assistantProvision(actor);
 const command=await repository.withScope(actor,provision.scope,async context=>{
  const saved=(await context.client.query("SELECT 1 FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-original' AND target_id=$2 LIMIT 1",[actor.companyId,operationId])).rows.length;
  if(saved){const original=await readFleetWorkOriginal(context.client,actor.companyId,operationId);if(original.requestFingerprint!==requestFingerprint||JSON.stringify(original.command.scope)!==JSON.stringify(provision.scope))throw new FleetError("fleet.operation_conflict",409);return original.command;}
  const canonical=createFleetWorkCanonicalService(context),now=new Date(),base={version:2,scope:provision.scope,operationId,capturedAt:now.toISOString(),timeZone:"UTC",dependencies:[]};
  let value:unknown;
  if(kind==="activity.create"){
   const {dispatch,...fields}=input;const create=CreateFleetRunSchema.parse({...fields,operationId});if(!create.detailSelection)throw new FleetError("fleet.detail_required",400);
   const preparation=await prepareFleetWorkCreation(context,{detailId:create.detailSelection.detailId,billingSiteId:create.stops[0].siteId,ticketId:create.billing.mode==="existing_ticket"?create.billing.ticketId:null});
   const created=buildFleetCreateIntent({scope:provision.scope,input:create,preparation,now:()=>now,uuid:randomUUID});created.payload.dispatchAfterCreate=dispatch===true;value=created;
  }else if(kind==="activity.action"||kind==="activity.edit"||kind==="quantity.record"||["quantity.review","price.resolve","charge.review","charge.adjust"].includes(kind)){
   const runId=z.uuid().parse(input.runId);
   if(!context.state.runs.some(run=>run.id===runId)){
    const saved=(await context.client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,runId])).rows[0];if(saved)context.state.runs.push(FleetRunSchema.parse(saved.tool_output));
   }
   const run=await canonical.detail({...actor},runId);if(!run.ticketReference||(!run.resourceAssignment&&!run.recoveredWork)||run.recoveredWork&&["activity.action","activity.edit","quantity.record"].includes(kind))throw new FleetError("fleet.ticketed_detail_required",409);
   const expectedVersion=kind==="activity.action"||kind==="activity.edit"?input.input.expectedVersion:input.expectedVersion;
   if(run.version!==expectedVersion)throw new FleetError("fleet.version_conflict",409);
   if(kind==="activity.action")value=buildFleetActionIntent(provision.scope,run,{...input.input,operationId},()=>now,run.schedule?.timezone??"UTC");
   else if(kind==="activity.edit"){const assignment=run.resourceAssignment;if(!assignment)throw new FleetError("fleet.ticketed_detail_required",409);value={...base,kind,timeZone:run.schedule?.timezone??"UTC",payload:{activity:{type:"canonical",kind:"activity",id:run.id,version:run.version},ticket:{type:"canonical",kind:"ticket",...run.ticketReference},baseAssignment:assignment.snapshot,edit:{...input.input,operationId}}};}
   else if(kind==="quantity.record")value={...base,kind,timeZone:run.schedule?.timezone??"UTC",payload:{activity:{type:"canonical",kind:"activity",id:run.id,version:run.version},ticket:{type:"canonical",kind:"ticket",...run.ticketReference},evidence:{...input.evidence,id:randomUUID(),capturedAt:base.capturedAt,recordedByUserId:actor.userId}}};
   else {const page=await readFleetCommercialReview(context,{activityId:run.id});if(!page.canReview||page.ticket.version!==input.ticketVersion)throw new FleetError("fleet.version_conflict",409);const {runId:_run,ticketVersion:_ticket,...fields}=input;const schema=FleetWorkCommandSchema.options.find(row=>row.shape.kind.value===kind)!.shape.payload as z.ZodObject;if(!("expectedVersion" in schema.shape))delete fields.expectedVersion;value={...base,kind,payload:{...fields,activity:{type:"canonical",kind:"activity",id:run.id,version:run.version},ticket:{type:"canonical",kind:"ticket",id:page.ticket.id,version:page.ticket.version}}};}
  }else if(kind==="ticket.finalize"){const {ticketId,...fields}=input;value={...base,kind,payload:{...fields,ticket:{type:"canonical",kind:"ticket",id:ticketId,version:input.expectedVersion}}};}
  else {value={...base,kind,payload:{...input,...(["service_template.save","detail.save","rig_package.save","run_order.save","monitoring.save","compliance.review","compliance.facts","requirements.adopt"].includes(kind)?{operationId}:{})}};}
  const original=FleetWorkCommandSchema.parse(value);await retainFleetWorkOriginal(context.client,original,undefined,requestFingerprint);return original;
 });
 const applied=await service.apply(actor,command);
 const stored=await service.read(actor,command.scope,command.operationId);const receipt=stored&&applied.status==="duplicate"?FleetWorkReceiptSchema.parse({...stored,status:"duplicate"}):stored;if(!receipt)throw new FleetError("fleet.outcome_unknown",503);
 return {receipt,operationId:command.operationId,physicalWorkStarted:kind==="activity.create"?false:undefined,checkedAt:new Date().toISOString()};
}
export async function readFleetAssistantReview(actor:FleetActor,raw:unknown){const input=z.object({runId:z.uuid(),after:z.string().optional()}).strict().parse(raw);return databaseFleetRepository.transaction(actor.companyId,actor.userId,(state,client)=>readFleetCommercialReview({actor,state,client},{activityId:input.runId,after:input.after}),actor);}
export async function readFleetAssistantRecovery(actor:FleetActor,raw:unknown){const input=z.object({after:z.string().optional(),limit:z.number().int().min(1).max(50).optional()}).strict().parse(raw);return databaseFleetRepository.transaction(actor.companyId,actor.userId,(state,client)=>readFleetReconciliation({actor,state,client},input),actor);}

export async function readFleetAssistantSources(actor:FleetActor,raw:unknown){
 const input=z.object({caseId:z.uuid(),view:z.enum(["reports","plan","choices"]),cursor:z.string().optional()}).strict().parse(raw);
 return databaseFleetRepository.transaction(actor.companyId,actor.userId,async(state,client)=>{
  const context={actor,state,client};
  if(input.view==="plan"){if(input.cursor)throw new FleetError("fleet.invalid_cursor",400);return readFleetRecoverySourcePlan(context,input.caseId);}
  if(input.view==="choices")return readFleetRecoveryOptions(context,input.caseId,input.cursor);
  return readFleetRecoverySources(context,input.caseId,{cursor:input.cursor,limit:50});
 },actor);
}

/** Read only: binds the exact confirmed business request to its private original
 * and durable canonical receipt. Never calls apply or makes a replacement op. */
export async function readFleetAssistantResult(actor:FleetActor,raw:unknown){
 const envelope=z.object({kind:z.string(),operationId:z.uuid()}).passthrough().parse(raw),definition=FLEET_COMMERCIAL_DEFINITIONS.find(row=>row.kind===envelope.kind);if(!definition)throw new FleetError("fleet.invalid_request",400);
 const {kind,operationId,...business}=envelope,input=definition.schema.parse(business),fingerprint=createHash("sha256").update(JSON.stringify(ordered({kind,input}))).digest("hex");
 const original=await databaseFleetRepository.transaction(actor.companyId,actor.userId,async(state,client)=>{
  const grant=state.grants.find(row=>row.userId===actor.userId);if(!state.enabled||!grant||definition.scope==="fleet:billing"&&(!grant.financeRead||!grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher"))||definition.scope==="fleet:dispatch"&&!grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher")&&!(kind==="activity.create"&&grant.roles.includes("driver")))throw new FleetError("fleet.recovery_forbidden",403);
  const saved=await readFleetWorkOriginal(client,actor.companyId,operationId);if(saved.requestFingerprint!==fingerprint||saved.command.kind!==kind||saved.command.scope.userId!==actor.userId||saved.command.scope.owner.type!=="vendor"||saved.command.scope.owner.id!==actor.companyId||saved.command.scope.membershipId!==actor.activeMembershipId)throw new FleetError("fleet.operation_conflict",409);
  const office=grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher");if(!office&&kind==="activity.create"&&(saved.command.kind!=="activity.create"||saved.command.payload.detailSnapshot.detail.driverUserId!==actor.userId))throw new FleetError("fleet.recovery_forbidden",403);
  return {...saved,canReadFinance:office&&grant.financeRead};
 },actor);
 const receipt=await service.read(actor,original.command.scope,operationId);if(!receipt)throw new FleetError("fleet.outcome_unknown",404);
 const {scope:_scope,fingerprint:_fingerprint,...safe}=receipt,applied=receipt.status==="applied"||receipt.status==="duplicate",resources:Array<{kind:string;value:unknown}>=[],accessibleTickets=new Set<number>();
 if(applied&&"canonicalReferences" in receipt){
  const {createFleetService}=await import("./fleet-ops"),canonical=createFleetService(databaseFleetRepository);
  for(const ref of receipt.canonicalReferences){
   if(ref.kind==="activity"){const value=await canonical.detail({...actor},String(ref.id));if(value.version<ref.version)throw new FleetError("fleet.outcome_unknown",409);resources.push({kind:ref.kind,value});if(value.linkedTicketId)accessibleTickets.add(value.linkedTicketId);}
   else if(ref.kind==="ticket")continue;
   else if(ref.kind==="detail")resources.push({kind:ref.kind,value:await canonical.fleetDetailSnapshot({...actor},String(ref.id))});
   else if(ref.kind==="rig_package")resources.push({kind:ref.kind,value:await canonical.fleetRigPackage({...actor},String(ref.id))});
   else if(ref.kind==="run_order")resources.push({kind:ref.kind,value:await canonical.fleetRunOrder({...actor},String(ref.id))});
  }
  const ticketIds=new Set([...accessibleTickets,...receipt.canonicalReferences.filter(ref=>ref.kind==="ticket").map(ref=>Number(ref.id))]);
  for(const ticketId of ticketIds){
   if(original.canReadFinance)resources.push({kind:"ticket",value:await canonical.ticketPlan({...actor},ticketId)});
   else{
    if(!accessibleTickets.has(ticketId))throw new FleetError("fleet.recovery_forbidden",403);
    const value=await databaseFleetRepository.transaction(actor.companyId,actor.userId,async(_state,client)=>{const row=(await client.query("SELECT id,status,fleet_plan FROM tickets WHERE id=$1 AND vendor_id=$2",[ticketId,actor.companyId])).rows[0];if(!row)throw new FleetError("fleet.not_found",404);return {ticketId:row.id,status:row.status,version:row.fleet_plan?.revision??row.fleet_plan?.version??null};},actor);resources.push({kind:"ticket",value});
   }
  }
 }
 return {operationId,canonicalApplied:applied,verified:true,receipt:safe,resources,readback:resources.length?"canonical_resources":"canonical_operation_receipt",checkedAt:new Date().toISOString()};
}
