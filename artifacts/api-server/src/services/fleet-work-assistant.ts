import {createHash,randomUUID} from "node:crypto";
import {z} from "zod/v4";
import {FleetWorkCommandSchema,CreateFleetRunSchema,buildFleetCreateIntent,buildFleetActionIntent,FleetWorkScopeSchema,FleetWorkReceiptSchema} from "@workspace/api-zod";
import {FLEET_COMMERCIAL_DEFINITIONS} from "../assistant/fleet-commercial-tools";
import {createDatabaseFleetWorkRepository} from "./fleet-work-repository";
import {executeFleetWorkCommand,createFleetWorkCanonicalService} from "./fleet-work-canonical";
import {createFleetWorkService} from "./fleet-work";
import {prepareFleetWorkCreation} from "./fleet-work-preparation";
import {retainFleetWorkOriginal,readFleetWorkOriginal} from "./fleet-work-originals";
import {FleetError,databaseFleetRepository} from "./fleet-repository";
import type {FleetActor} from "./fleet-ops";
import {readFleetCommercialReview} from "./fleet-commercial-review";
import {readFleetReconciliation} from "./fleet-reconciliation";
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
   const create=CreateFleetRunSchema.parse({...input,operationId});if(!create.detailSelection)throw new FleetError("fleet.detail_required",400);
   const preparation=await prepareFleetWorkCreation(context,{detailId:create.detailSelection.detailId,billingSiteId:create.stops[0].siteId,ticketId:create.billing.mode==="existing_ticket"?create.billing.ticketId:null});
   value=buildFleetCreateIntent({scope:provision.scope,input:create,preparation,now:()=>now,uuid:randomUUID});
  }else if(kind==="activity.action"||kind==="activity.edit"||kind==="quantity.record"||["quantity.review","price.resolve","charge.review","charge.adjust"].includes(kind)){
   const run=await canonical.detail({...actor},z.uuid().parse(input.runId));if(!run.ticketReference||!run.resourceAssignment)throw new FleetError("fleet.ticketed_detail_required",409);
   const expectedVersion=kind==="activity.action"||kind==="activity.edit"?input.input.expectedVersion:input.expectedVersion;
   if(run.version!==expectedVersion)throw new FleetError("fleet.version_conflict",409);
   if(kind==="activity.action")value=buildFleetActionIntent(provision.scope,run,{...input.input,operationId},()=>now,run.schedule?.timezone??"UTC");
   else if(kind==="activity.edit")value={...base,kind,timeZone:run.schedule?.timezone??"UTC",payload:{activity:{type:"canonical",kind:"activity",id:run.id,version:run.version},ticket:{type:"canonical",kind:"ticket",...run.ticketReference},baseAssignment:run.resourceAssignment.snapshot,edit:{...input.input,operationId}}};
   else if(kind==="quantity.record")value={...base,kind,timeZone:run.schedule?.timezone??"UTC",payload:{activity:{type:"canonical",kind:"activity",id:run.id,version:run.version},ticket:{type:"canonical",kind:"ticket",...run.ticketReference},evidence:{...input.evidence,id:randomUUID(),capturedAt:base.capturedAt,recordedByUserId:actor.userId}}};
   else {const page=await readFleetCommercialReview(context,{activityId:run.id});if(!page.canReview||page.ticket.version!==input.ticketVersion)throw new FleetError("fleet.version_conflict",409);const {runId:_run,ticketVersion:_ticket,...fields}=input;const schema=FleetWorkCommandSchema.options.find(row=>row.shape.kind.value===kind)!.shape.payload as z.ZodObject;if(!("expectedVersion" in schema.shape))delete fields.expectedVersion;value={...base,kind,payload:{...fields,activity:{type:"canonical",kind:"activity",id:run.id,version:run.version},ticket:{type:"canonical",kind:"ticket",id:page.ticket.id,version:page.ticket.version}}};}
  }else if(kind==="ticket.finalize"){const {ticketId,...fields}=input;value={...base,kind,payload:{...fields,ticket:{type:"canonical",kind:"ticket",id:ticketId,version:input.expectedVersion}}};}
  else {value={...base,kind,payload:{...input,...(["detail.save","rig_package.save","run_order.save","monitoring.save"].includes(kind)?{operationId}:{})}};}
  const original=FleetWorkCommandSchema.parse(value);await retainFleetWorkOriginal(context.client,original,undefined,requestFingerprint);return original;
 });
 const applied=await service.apply(actor,command);
 const stored=await service.read(actor,command.scope,command.operationId);const receipt=stored&&applied.status==="duplicate"?FleetWorkReceiptSchema.parse({...stored,status:"duplicate"}):stored;if(!receipt)throw new FleetError("fleet.outcome_unknown",503);
 return {receipt,operationId:command.operationId,physicalWorkStarted:kind==="activity.create"?false:undefined,checkedAt:new Date().toISOString()};
}
export async function readFleetAssistantReview(actor:FleetActor,raw:unknown){const input=z.object({runId:z.uuid(),after:z.string().optional()}).strict().parse(raw);return databaseFleetRepository.transaction(actor.companyId,actor.userId,(state,client)=>readFleetCommercialReview({actor,state,client},{activityId:input.runId,after:input.after}),actor);}
export async function readFleetAssistantRecovery(actor:FleetActor,raw:unknown){const input=z.object({after:z.string().optional(),limit:z.number().int().min(1).max(50).optional()}).strict().parse(raw);return databaseFleetRepository.transaction(actor.companyId,actor.userId,(state,client)=>readFleetReconciliation({actor,state,client},input),actor);}
