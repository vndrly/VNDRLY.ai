import {FleetWorkEvidencePageSchema} from "./fleet-evidence-upload";
import {synchronizeFleetEvidence} from "./fleet-work-evidence-client";
import {z} from "zod/v4";
import {FleetWorkScopeSchema,FleetWorkReceiptSchema,FleetWorkCommandSchema,type FleetWorkScope,type FleetWorkCommand} from "./fleet-work";
import {FleetQuantityEvidenceSchema} from "./fleet-pricing";
import {FleetCommercialReviewSchema} from "./fleet-commercial-review";
import type {FleetJournalStore,DurableFleetWorkJournal} from "./fleet-work-journal";
import {synchronizeFleetWork} from "./fleet-work-runtime";
import {buildFleetCreateIntent,buildFleetActionIntent,FleetWorkPreparationSchema} from "./fleet-work-builder";
import {CreateFleetRunSchema,FleetRunSchema,FleetActionInputSchema,type FleetRun,type FleetActionInput} from "./fleet";
const accountSchema=z.object({userId:z.number().int().positive(),companyId:z.number().int().positive(),membershipId:z.number().int().positive(),sessionVersion:z.number().int().nonnegative()}).strict();
export type FleetWorkAccount=z.infer<typeof accountSchema>;
export type FleetEvidenceJournal=DurableFleetWorkJournal & {stageEvidence?:(id:string,source:unknown,contentType:string,makeCommand?:(media:{sha256:string;byteSize:number;contentType:string})=>FleetWorkCommand)=>Promise<{id:string;sha256:string;byteSize:number;contentType:string;durability:"durable"}>;readEvidencePart?:(id:string,offset:number,length:number)=>Promise<Uint8Array>};
const provisionSchema=z.object({scope:FleetWorkScopeSchema,expiresAt:z.iso.datetime()});
export const FleetReportedQuantityInputSchema=FleetQuantityEvidenceSchema.pick({cycleId:true,quantity:true,unit:true,evidenceReferences:true}).extend({kind:z.enum(["planned","picked_up","delivered"]),source:z.enum(["meter","scale","manifest","recipient","manual"])}).strict();
export type FleetReportedQuantityInput=z.infer<typeof FleetReportedQuantityInputSchema>;
/** The account comes from an authenticated overview (or its original encrypted
 * cache). Provisioning is a device/session binding, never a new business grant.
 * A new account/session has a different index; old journals are never rebound. */
export async function openFleetWorkSession(options:{account:FleetWorkAccount;index:FleetJournalStore;openJournal:(scope:FleetWorkScope)=>Promise<FleetEvidenceJournal>;isCurrent:()=>boolean;http:(path:string,body?:unknown)=>Promise<unknown>;uuid:()=>string;putEvidencePart?:(path:string,bytes:Uint8Array,sha256:string,scope:FleetWorkScope)=>Promise<unknown>;hashBytes?:(bytes:Uint8Array)=>Promise<string>}){
 const account=accountSchema.parse(options.account),key=JSON.stringify(account),current=()=>{if(!options.isCurrent())throw Error("Original Fleet work scope changed");};
 current();const raw=await options.index.transaction(tx=>tx.get("work-session",key));let provision=raw?provisionSchema.parse(JSON.parse(raw)):null;
 let enabled=true;try{enabled=z.object({enabled:z.boolean()}).parse(await options.http("/api/fleet/work/capabilities")).enabled;}catch(error){if(!provision)throw error;}
 if(!enabled&&!provision)return null;
 if(!provision){
  const deviceKey=`device:${key}`,stored=await options.index.transaction(tx=>tx.get("work-session",deviceKey)),deviceId=stored?z.uuid().parse(stored):z.uuid().parse(options.uuid());
  if(!stored)await options.index.transaction(tx=>tx.set("work-session",deviceKey,deviceId));
  current();const device=z.object({id:z.uuid()}).parse(await options.http("/api/work-hub/devices/register",{deviceId,friendlyName:"Fleet work device",deviceClass:"other",capabilities:{}}));
  current();provision=provisionSchema.parse(await options.http("/api/fleet/work/provision",{deviceId:device.id,appVersion:"fleet-commercial-v2"}));
  if(provision.scope.deviceId!==device.id)throw Error("Original Fleet device scope changed");
 }
 const scope=provision.scope;
 if(scope.owner.type!=="vendor"||scope.owner.id!==account.companyId||scope.userId!==account.userId||scope.membershipId!==account.membershipId||scope.sessionVersion!==account.sessionVersion)throw Error("Original Fleet work scope changed");
 current();await options.index.transaction(tx=>tx.set("work-session",key,JSON.stringify(provision)));
 const journal=await options.openJournal(scope),transport={
  lookup:async(command:FleetWorkCommand)=>z.object({receipt:FleetWorkReceiptSchema.nullable(),checkedAt:z.iso.datetime()}).parse(await options.http(`/api/fleet/work/operations/${command.operationId}`,{scope})),
  apply:async(command:FleetWorkCommand)=>FleetWorkReceiptSchema.parse(await options.http("/api/fleet/work/commands",command)),
 };
 const synchronize=async()=>{const result=await synchronizeFleetWork(scope,{journal,transport,isCurrent:options.isCurrent});if(journal.readEvidencePart&&options.putEvidencePart&&options.hashBytes)await synchronizeFleetEvidence({scope,journal,isCurrent:options.isCurrent,http:options.http,put:(path,bytes,hash)=>options.putEvidencePart!(path,bytes,hash,scope),read:(...args)=>journal.readEvidencePart!(...args),hash:options.hashBytes});return result;};
 const execute=async(command:FleetWorkCommand)=>{current();await journal.append(command);try{await synchronize();}catch{current();}
   const entry=(await journal.readState()).entries.find(row=>row.command.operationId===command.operationId)!;
   return {state:entry.delivery.state,canonicalApplied:entry.delivery.state==="applied",receipt:entry.delivery.receipt,operationId:command.operationId};
 };
 const prepareCreate=async(raw:unknown)=>{
  const input=CreateFleetRunSchema.parse(raw);if(!input.detailSelection)throw Error("Choose a saved Detail for durable Fleet work");
  const body={scope,detailId:input.detailSelection.detailId,billingSiteId:input.stops[0].siteId,ticketId:input.billing.mode==="existing_ticket"?input.billing.ticketId:null},key=`prepare:${JSON.stringify(body)}`;
  try{current();const prepared=FleetWorkPreparationSchema.parse(await options.http("/api/fleet/work/prepare-create",body));current();await journal.putCache(key,prepared);return prepared;}
  catch(error){current();if(error&&typeof error==="object"&&"status" in error&&Number(error.status)<500)throw error;const saved=await journal.readCache(key);if(!saved)throw error;return FleetWorkPreparationSchema.parse(saved);}
 };
 return {scope,journal,expiresAt:provision.expiresAt,enabled,synchronize,execute,prepareCreate,
  cacheRun:async(run:FleetRun)=>{current();const saved=FleetRunSchema.parse(run);if(saved.companyId!==account.companyId)throw Error("Original Fleet run scope changed");await journal.putCache(`run:${saved.id}`,saved);},
  readRun:async(id:string)=>{const value=await journal.readCache(`run:${z.uuid().parse(id)}`);return value?FleetRunSchema.parse(value):null;},
  async evidencePage(activityId:string,cursor:string|null=null){current();const page=FleetWorkEvidencePageSchema.parse(await options.http(`/api/fleet/work/activities/${z.uuid().parse(activityId)}/evidence`,{scope,cursor}));if(page.evidence.some(row=>row.record.runId!==activityId||row.record.companyId!==account.companyId))throw Error("Evidence readback scope changed");return page;},
  async commercialReview(activityId:string,after?:string){current();const id=z.uuid().parse(activityId),page=FleetCommercialReviewSchema.parse(await options.http(`/api/fleet/work/activities/${id}/commercial-review`,{scope,after}));current();if(page.activityId!==id)throw Error("Commercial review readback scope changed");return page;},
  async captureQuantity(run:FleetRun,raw:FleetReportedQuantityInput){
   current();if(!run.ticketReference||run.companyId!==account.companyId||run.driverUserId!==account.userId||run.resourceAssignment?.snapshot?.detail.driverUserId!==account.userId)throw Error("Original own-driver quantity context is required");
   const input=FleetReportedQuantityInputSchema.parse(raw),capturedAt=new Date().toISOString();
   return execute(FleetWorkCommandSchema.parse({version:2,scope,operationId:options.uuid(),capturedAt,timeZone:run.schedule?.timezone??"UTC",dependencies:[],kind:"quantity.record",payload:{activity:{type:"canonical",kind:"activity",id:run.id,version:run.version},ticket:{type:"canonical",kind:"ticket",...run.ticketReference},evidence:{...input,id:options.uuid(),capturedAt,recordedByUserId:account.userId}}}));
  },
  async captureEvidence(run:FleetRun,source:unknown,contentType:string,kind:"photo"|"scale"|"receipt"|"signature",notes:string){
   current();if(!journal.stageEvidence||!run.resourceAssignment?.snapshot||!run.ticketReference||run.companyId!==account.companyId||run.driverUserId!==account.userId)throw Error("Original own-driver evidence context is required");
   const operationId=options.uuid(),id=options.uuid(),capturedAt=new Date().toISOString();
   await journal.stageEvidence(id,source,contentType,media=>({version:2,scope,operationId,capturedAt,timeZone:run.schedule?.timezone??"UTC",dependencies:[],kind:"evidence.stage",payload:{evidence:{type:"local",kind:"evidence",id},activity:{type:"canonical",kind:"activity",id:run.id,version:run.version},ticket:{type:"canonical",kind:"ticket",...run.ticketReference!},kind,byteSize:media.byteSize,sha256:media.sha256,contentType:contentType as "image/jpeg",notes,assignment:run.resourceAssignment!.snapshot}}));
   return {operationId,localEvidenceId:id,canonicalApplied:false as const,durability:"durable" as const};
  },
  async captureCreate(raw:unknown){const input=CreateFleetRunSchema.parse(raw),sourceKey=`create-source:${input.operationId}`,priorSource=await journal.readCache(sourceKey),original=(await journal.readState()).entries.find(row=>row.command.operationId===input.operationId);
   if(priorSource&&JSON.stringify(priorSource)!==JSON.stringify(input))throw Error("Cannot change an original Fleet request; use a new operation");
   if(original){if(original.command.kind!=="activity.create"||!priorSource)throw Error("Retained original Fleet request needs recovery");return execute(original.command);}
   const preparation=await prepareCreate(input),command=buildFleetCreateIntent({scope,input,preparation,uuid:options.uuid,now:()=>new Date()});await journal.putCache(sourceKey,input);return execute(command);
  },
  async captureAction(run:FleetRun,raw:FleetActionInput,timeZone:string){const action=FleetActionInputSchema.parse(raw),original=(await journal.readState()).entries.find(row=>row.command.operationId===action.operationId);
   if(original){if(original.command.kind!=="activity.action"||JSON.stringify(original.command.payload.action)!==JSON.stringify(action))throw Error("Cannot change an original Fleet action");return execute(original.command);}
   return execute(buildFleetActionIntent(scope,run,action,()=>new Date(),timeZone));
  },
 };
}
export type FleetWorkSession=NonNullable<Awaited<ReturnType<typeof openFleetWorkSession>>>;
