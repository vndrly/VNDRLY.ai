import {FleetDestinationDirectorySchema} from "./fleet-commercial";
import {FleetRecoverySourcePageSchema,FleetRecoverySourcePlanSchema} from "./fleet-recovery-sources";
import type {FleetStorageHealth} from "./fleet-storage-health";
import {FleetRunOrderPageSchema,FleetRunOrderSchema} from "./fleet-run-order";
import {FleetWorkEvidencePageSchema} from "./fleet-evidence-upload";
import {synchronizeFleetEvidence} from "./fleet-work-evidence-client";
import {z} from "zod/v4";
import {FleetWorkScopeSchema,FleetWorkReceiptSchema,FleetWorkOriginalRetentionSchema,FleetWorkCommandSchema,type FleetWorkScope,type FleetWorkCommand} from "./fleet-work";
import {FleetQuantityEvidenceSchema} from "./fleet-pricing";
import {FleetCommercialReviewSchema,type FleetCommercialReview,type FleetOfficeReviewAction} from "./fleet-commercial-review";
import {FleetReconciliationPageSchema,FleetRecoveryOptionsSchema,type FleetReconciliationPage} from "./fleet-reconciliation";
import {FleetDetailSnapshotSchema,FleetDetailPageSchema} from "./fleet-details";
import {FleetDraftEditSchema} from "./fleet-planning";
import type {FleetReplacementInputSchema,FleetReplacementActionSchema} from "./fleet-replacement";
import type {FleetCargoTransferInputSchema,FleetCargoTransferActionSchema} from "./fleet-cargo";
import type {FleetJournalStore,DurableFleetWorkJournal} from "./fleet-work-journal";
import {synchronizeFleetWork} from "./fleet-work-runtime";
import {buildFleetCreateIntent,buildFleetActionIntent,FleetWorkPreparationSchema,FleetWorkBillingOptionsSchema} from "./fleet-work-builder";
import {CreateFleetRunSchema,FleetRunSchema,FleetActionInputSchema,type FleetRun,type FleetActionInput} from "./fleet";
const accountSchema=z.object({userId:z.number().int().positive(),companyId:z.number().int().positive(),membershipId:z.number().int().positive(),sessionVersion:z.number().int().nonnegative()}).strict();
export type FleetWorkAccount=z.infer<typeof accountSchema>;
export type FleetEvidenceJournal=DurableFleetWorkJournal & {readStorageHealth?:()=>Promise<FleetStorageHealth>;stageEvidence?:(id:string,source:unknown,contentType:string,makeCommand?:(media:{sha256:string;byteSize:number;contentType:string})=>FleetWorkCommand)=>Promise<{id:string;sha256:string;byteSize:number;contentType:string;durability:"durable"}>;readEvidencePart?:(id:string,offset:number,length:number)=>Promise<Uint8Array>};
const provisionSchema=z.object({scope:FleetWorkScopeSchema,expiresAt:z.iso.datetime()});
export const FleetReportedQuantityInputSchema=FleetQuantityEvidenceSchema.pick({cycleId:true,quantity:true,unit:true,evidenceReferences:true}).extend({kind:z.enum(["planned","picked_up","delivered"]),source:z.enum(["meter","scale","manifest","recipient","manual"])}).strict();
export type FleetReportedQuantityInput=z.infer<typeof FleetReportedQuantityInputSchema>;
export type FleetAncillaryIntent=
 |{kind:"replacement.propose";input:z.infer<typeof FleetReplacementInputSchema>}
 |{kind:"replacement.action";recordId:string;input:z.infer<typeof FleetReplacementActionSchema>}
 |{kind:"cargo.propose";target:FleetRun;input:z.infer<typeof FleetCargoTransferInputSchema>}
 |{kind:"cargo.action";recordId:string;input:z.infer<typeof FleetCargoTransferActionSchema>};
/** The account comes from an authenticated overview (or its original encrypted
 * cache). Provisioning is a device/session binding, never a new business grant.
 * A new account/session has a different index; old journals are never rebound. */
export async function openFleetWorkSession(options:{account:FleetWorkAccount;index:FleetJournalStore;openJournal:(scope:FleetWorkScope)=>Promise<FleetEvidenceJournal>;isCurrent:()=>boolean;http:(path:string,body?:unknown)=>Promise<unknown>;uuid:()=>string;putEvidencePart?:(path:string,bytes:Uint8Array,sha256:string,scope:FleetWorkScope)=>Promise<unknown>;hashBytes?:(bytes:Uint8Array)=>Promise<string>;withSynchronizationLock?:(work:()=>Promise<unknown>)=>Promise<unknown>}){
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
 current();await options.index.transaction(async tx=>{await tx.set("work-session",key,JSON.stringify(provision));await tx.set("fleet-provisions",scope.provisioningId,JSON.stringify(provision));});
 const journal=await options.openJournal(scope),transport={
  lookup:async(command:FleetWorkCommand)=>z.object({receipt:FleetWorkReceiptSchema.nullable(),checkedAt:z.iso.datetime()}).parse(await options.http(`/api/fleet/work/operations/${command.operationId}`,{scope})),
  apply:async(command:FleetWorkCommand)=>FleetWorkReceiptSchema.parse(await options.http("/api/fleet/work/commands",command)),
  retain:async(command:FleetWorkCommand)=>FleetWorkOriginalRetentionSchema.parse(await options.http("/api/fleet/work/originals",command)),
 };
 const priorRecords=async()=>{current();return (await options.index.transaction(tx=>tx.values("fleet-provisions"))).map(raw=>provisionSchema.parse(JSON.parse(raw))).filter(record=>record.scope.provisioningId!==scope.provisioningId&&record.scope.owner.type==="vendor"&&record.scope.owner.id===account.companyId&&record.scope.userId===account.userId&&record.scope.membershipId===account.membershipId);};
 const drainPrior=async(record:ReturnType<typeof provisionSchema.parse>)=>{current();const original=record.scope,retained=await options.openJournal(original),bound={lookup:async(command:FleetWorkCommand)=>z.object({receipt:FleetWorkReceiptSchema.nullable(),checkedAt:z.iso.datetime()}).parse(await options.http(`/api/fleet/work/operations/${command.operationId}`,{scope:original})),apply:async(command:FleetWorkCommand)=>FleetWorkReceiptSchema.parse(await options.http("/api/fleet/work/commands",command)),retain:async(command:FleetWorkCommand)=>FleetWorkOriginalRetentionSchema.parse(await options.http("/api/fleet/work/originals",command))};
  for(const entry of (await retained.readState()).entries.filter(row=>["needs_reconciliation","denied"].includes(row.delivery.state)).slice(0,25)){try{const value=await bound.lookup(entry.command);if(value.receipt&&["applied","duplicate","retained"].includes(value.receipt.status))await retained.applyReceipt(original,value.receipt);}catch{current();}}
  await synchronizeFleetWork(original,{journal:retained,transport:bound,isCurrent:options.isCurrent});if(retained.readEvidencePart&&options.putEvidencePart&&options.hashBytes)await synchronizeFleetEvidence({scope:original,journal:retained,isCurrent:options.isCurrent,http:options.http,put:(path,bytes,hash)=>options.putEvidencePart!(path,bytes,hash,original),read:(...args)=>retained.readEvidencePart!(...args),hash:options.hashBytes});return retained.readStatus(original);
 };
 let synchronizing:Promise<unknown>|null=null;
 const synchronize=()=>{if(synchronizing)return synchronizing;const task=(options.withSynchronizationLock??(work=>work()))(async()=>{
  current();if(Date.parse(provision!.expiresAt)<=Date.now()){const renewed=provisionSchema.parse(await options.http("/api/fleet/work/provision/renew",{scope}));current();if(JSON.stringify(renewed.scope)!==JSON.stringify(scope))throw Error("Renewal cannot rebind original work");provision=renewed;await options.index.transaction(tx=>tx.set("work-session",key,JSON.stringify(renewed)));}
  current();const entries=(await journal.readState()).entries.filter(row=>["needs_reconciliation","denied"].includes(row.delivery.state)),cursor=Number(await journal.readCache("resolution-cursor")??0),ordered=[...entries.filter(row=>row.sequence>cursor),...entries.filter(row=>row.sequence<=cursor)];
  for(const entry of ordered.slice(0,25)){current();try{const saved=await transport.lookup(entry.command);current();if(saved.receipt&&["applied","duplicate","retained"].includes(saved.receipt.status))await journal.applyReceipt(scope,saved.receipt);}catch{current();}await journal.putCache("resolution-cursor",entry.sequence);}
  const result=await synchronizeFleetWork(scope,{journal,transport,isCurrent:options.isCurrent});if(journal.readEvidencePart&&options.putEvidencePart&&options.hashBytes)await synchronizeFleetEvidence({scope,journal,isCurrent:options.isCurrent,http:options.http,put:(path,bytes,hash)=>options.putEvidencePart!(path,bytes,hash,scope),read:(...args)=>journal.readEvidencePart!(...args),hash:options.hashBytes});for(const prior of await priorRecords()){const authorized=await options.index.transaction(tx=>tx.get("fleet-reauthorized",prior.scope.provisioningId));if(authorized===String(account.sessionVersion))try{await drainPrior(prior);}catch{current();}}return result;
 });synchronizing=task;void task.finally(()=>{if(synchronizing===task)synchronizing=null;}).catch(()=>undefined);return task;};
 const execute=async(command:FleetWorkCommand)=>{current();await journal.append(command);let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([synchronize(),new Promise<void>(resolve=>{timer=setTimeout(resolve,1500);})]);}catch{current();}finally{if(timer!==undefined)clearTimeout(timer);}
   const entry=(await journal.readState()).entries.find(row=>row.command.operationId===command.operationId)!;
   return {state:entry.delivery.state,canonicalApplied:entry.delivery.state==="applied",receipt:entry.delivery.receipt,operationId:command.operationId};
 };
 const dependenciesFor=async(run:FleetRun)=>{const entries=(await journal.readState()).entries.filter(e=>("activity" in e.command.payload&&e.command.payload.activity.id===run.id)||(e.command.kind==="activity.create"&&e.command.payload.activityId===run.id)).sort((a,b)=>a.sequence-b.sequence);return entries.length?[entries.at(-1)!.command.operationId]:[];};
 const referencesFor=(run:FleetRun)=>({activity:run.localWork?{type:"local" as const,kind:"activity" as const,id:run.id}:{type:"canonical" as const,kind:"activity" as const,id:run.id,version:run.version},ticket:run.localWork?.ticket??{type:"canonical" as const,kind:"ticket" as const,...run.ticketReference!}});
 const prepareSelection=async(detailId:string,billingSiteId:number,ticketId:number|null)=>{
  const body={scope,detailId:z.uuid().parse(detailId),billingSiteId:z.number().int().positive().parse(billingSiteId),ticketId:ticketId===null?null:z.number().int().positive().parse(ticketId)},key=`prepare:${JSON.stringify(body)}`;
  try{current();const prepared=FleetWorkPreparationSchema.parse(await options.http("/api/fleet/work/prepare-create",body));current();await journal.putCache(key,prepared);return prepared;}
  catch(error){current();if(error&&typeof error==="object"&&"status" in error&&Number(error.status)<500)throw error;const saved=await journal.readCache(key);if(!saved)throw error;return FleetWorkPreparationSchema.parse(saved);}
 };
 const prepareCreate=async(raw:unknown)=>{const input=CreateFleetRunSchema.parse(raw);if(!input.detailSelection)throw Error("Choose a saved Detail for durable Fleet work");return prepareSelection(input.detailSelection.detailId,input.stops[0].siteId,input.billing.mode==="existing_ticket"?input.billing.ticketId:null);};

 return {scope,journal,
  async priorWork(){const records=await priorRecords(),items=[];for(const record of records){try{const retained=await options.openJournal(record.scope),status=await retained.readStatus(record.scope);if(status.pending||status.pendingEvidence||status.needsReconciliation)items.push({provisioningId:record.scope.provisioningId,sessionVersion:record.scope.sessionVersion,...status});}catch{items.push({provisioningId:record.scope.provisioningId,sessionVersion:record.scope.sessionVersion,pending:0,pendingEvidence:0,needsReconciliation:1,locked:true});}}return items;},
  async reauthorizePriorWork(provisioningId:string,reason:string){current();const record=(await priorRecords()).find(row=>row.scope.provisioningId===provisioningId);if(!record)throw Error("Original retained account context is unavailable");const renewed=provisionSchema.parse(await options.http("/api/fleet/work/provision/reauthorize",{scope:record.scope,operationId:options.uuid(),reason}));current();if(JSON.stringify(renewed.scope)!==JSON.stringify(record.scope))throw Error("Recovery cannot rebind originals");await options.index.transaction(async tx=>{await tx.set("fleet-provisions",provisioningId,JSON.stringify(renewed));await tx.set("fleet-reauthorized",provisioningId,String(account.sessionVersion));});return drainPrior(renewed);},
  get expiresAt(){return provision!.expiresAt;},enabled,synchronize,execute,prepareCreate,prepareSelection,
  async captureAncillary(run:FleetRun,intent:FleetAncillaryIntent){
   current();if(run.companyId!==account.companyId||!run.ticketReference||!run.resourceAssignment)throw Error("An original ticketed Detail is required");
   const source={kind:intent.kind,input:intent.input,recordId:"recordId" in intent?intent.recordId:null,targetId:"target" in intent?intent.target.id:null},key=`ancillary-source:${intent.input.operationId}`,prior=await journal.readCache(key),original=(await journal.readState()).entries.find(row=>row.command.operationId===intent.input.operationId);
   if(prior&&JSON.stringify(prior)!==JSON.stringify(source))throw Error("Cannot change an original ancillary request");
   if(original){if(!prior||original.command.kind!==intent.kind)throw Error("Retained ancillary work needs recovery");return execute(original.command);}
   const payload={activity:{type:"canonical",kind:"activity",id:run.id,version:run.version},ticket:{type:"canonical",kind:"ticket",...run.ticketReference},baseAssignment:run.resourceAssignment.snapshot,input:intent.input};
   let specific:unknown=payload;if(intent.kind==="replacement.action")specific={...payload,replacementId:intent.recordId};if(intent.kind==="cargo.action")specific={...payload,transferId:intent.recordId};if(intent.kind==="cargo.propose"){if(intent.target.companyId!==account.companyId||!intent.target.ticketReference)throw Error("Choose an authorized ticketed recipient");specific={...payload,target:{type:"canonical",kind:"activity",id:intent.target.id,version:intent.target.version},targetTicket:{type:"canonical",kind:"ticket",...intent.target.ticketReference}};}
   const command=FleetWorkCommandSchema.parse({version:2,scope,operationId:intent.input.operationId,capturedAt:new Date().toISOString(),timeZone:run.schedule?.timezone??"UTC",dependencies:[],kind:intent.kind,payload:specific});await journal.putCache(key,source);return execute(command);
  },
  async captureDraft(run:FleetRun,raw:z.infer<typeof FleetDraftEditSchema>){current();const edit=FleetDraftEditSchema.parse(raw),original=(await journal.readState()).entries.find(row=>row.command.operationId===edit.operationId);if(original){if(original.command.kind!=="activity.edit"||JSON.stringify(original.command.payload.edit)!==JSON.stringify(edit))throw Error("Cannot change an original draft edit");return execute(original.command);}if(!run.ticketReference||!run.resourceAssignment||run.companyId!==account.companyId)throw Error("Original ticketed draft context is required");return execute(FleetWorkCommandSchema.parse({version:2,scope,operationId:edit.operationId,capturedAt:new Date().toISOString(),timeZone:edit.schedule?.timezone??run.schedule?.timezone??"UTC",dependencies:[],kind:"activity.edit",payload:{activity:{type:"canonical",kind:"activity",id:run.id,version:edit.expectedVersion},ticket:{type:"canonical",kind:"ticket",...run.ticketReference},baseAssignment:run.resourceAssignment.snapshot,edit}}));},
  async directory(){current();const key="commercial-directory";try{const value=FleetDestinationDirectorySchema.parse(await options.http("/api/fleet/commercial"));current();await journal.putCache(key,value);return value;}catch(error){current();if(error&&typeof error==="object"&&"status" in error&&Number(error.status)<500)throw error;const saved=await journal.readCache(key);if(!saved)throw error;return FleetDestinationDirectorySchema.parse(saved);}},
  async runOrderChoices(after?:number){current();const key=`run-order-choices:${after??""}`;try{const value=FleetRunOrderPageSchema.parse(await options.http(`/api/fleet/run-orders${after?`?after=${after}`:""}`));current();if(value.orders.some(row=>row.companyId!==account.companyId))throw Error("Original company changed");await journal.putCache(key,value);for(const row of value.orders)await journal.putCache(`run-order:${row.id}`,row);return value;}catch(error){current();if(error&&typeof error==="object"&&"status" in error&&Number(error.status)<500)throw error;const saved=await journal.readCache(key);if(!saved)throw error;return FleetRunOrderPageSchema.parse(saved);}},
  async runOrder(id:string){current();id=z.uuid().parse(id);const key=`run-order:${id}`;try{const value=FleetRunOrderSchema.parse(await options.http(`/api/fleet/run-orders/${id}`));current();if(value.companyId!==account.companyId||value.id!==id)throw Error("Original company changed");await journal.putCache(key,value);return value;}catch(error){current();if(error&&typeof error==="object"&&"status" in error&&Number(error.status)<500)throw error;const saved=await journal.readCache(key);if(!saved)throw error;return FleetRunOrderSchema.parse(saved);}},
  async detailChoices(after?:string){current();const key=`detail-choices:${after??""}`;try{const saved=FleetDetailPageSchema.parse(await options.http(`/api/fleet/details?limit=50${after?`&after=${encodeURIComponent(after)}`:""}`));current();if(saved.details.some(row=>row.companyId!==account.companyId))throw Error("Original Detail company changed");await journal.putCache(key,saved);return saved;}catch(error){current();if(error&&typeof error==="object"&&"status" in error&&Number(error.status)<500)throw error;const cached=await journal.readCache(key);if(!cached)throw error;return FleetDetailPageSchema.parse(cached);}},
  async billingOptions(input:{fleetId:string;siteId:number;afeNumber:string;workDate:string}){current();const key=`billing-options:${JSON.stringify(input)}`;try{const saved=FleetWorkBillingOptionsSchema.parse(await options.http("/api/fleet/work/billing-options",{scope,...input}));current();await journal.putCache(key,saved);return saved;}catch(error){current();if(error&&typeof error==="object"&&"status" in error&&Number(error.status)<500)throw error;const cached=await journal.readCache(key);if(!cached)throw error;return FleetWorkBillingOptionsSchema.parse({...FleetWorkBillingOptionsSchema.parse(cached),referenceFreshness:"cached_unverified"});}},
  async reconciliation(after?:string){current();const result=FleetReconciliationPageSchema.parse(await options.http("/api/fleet/work/reconciliation",{scope,after}));current();return result;},
  async recoveryOptions(caseId:string,after?:string){current();const result=FleetRecoveryOptionsSchema.parse(await options.http(`/api/fleet/work/reconciliation/${z.uuid().parse(caseId)}/options`,{scope,after}));current();return result;},
  async recoverySources(caseId:string,cursor?:string){current();const result=FleetRecoverySourcePageSchema.parse(await options.http(`/api/fleet/work/reconciliation/${z.uuid().parse(caseId)}/sources`,{scope,cursor}));current();if(result.caseId!==caseId)throw Error("Original recovery case changed");return result;},
  async recoverySourcePlan(caseId:string){current();const result=FleetRecoverySourcePlanSchema.parse(await options.http(`/api/fleet/work/reconciliation/${z.uuid().parse(caseId)}/source-plan`,{scope}));current();if(result.caseId!==caseId)throw Error("Original recovery case changed");return result;},
  async recoveryDetail(id:string){current();const key=`detail-snapshot:${z.uuid().parse(id)}`;try{const result=FleetDetailSnapshotSchema.parse(await options.http(`/api/fleet/details/${id}`));current();if(result.detail.companyId!==account.companyId)throw Error("Original Detail company changed");await journal.putCache(key,result);return result;}catch(error){current();if(error&&typeof error==="object"&&"status" in error&&Number(error.status)<500)throw error;const cached=await journal.readCache(key);if(!cached)throw error;return FleetDetailSnapshotSchema.parse(cached);}},
  async captureReconciliation(item:FleetReconciliationPage["cases"][number],resolution:Extract<FleetWorkCommand,{kind:"activity.reconcile"}>["payload"]["resolution"],reason:string){
   current();if(!item.canResolve||item.case.resolution||!item.original.activity||!item.original.ticket)throw Error("Current office recovery context is required");
   const selected=resolution.kind==="create_ticket"?{...resolution,billing:{...resolution.billing,choice:"new_ticket",ticket:{type:"local",kind:"ticket",id:options.uuid()}}}:resolution;
   const recoveryDriverUserId=resolution.kind==="correct_assignment"?resolution.snapshot.detail.driverUserId:item.original.driverUserId;
   return execute(FleetWorkCommandSchema.parse({version:2,scope,operationId:options.uuid(),capturedAt:new Date().toISOString(),timeZone:item.original.timeZone,dependencies:[],kind:"activity.reconcile",payload:{caseId:item.case.id,expectedVersion:item.case.version,activity:item.original.activity,originalTicket:item.original.ticket,...(recoveryDriverUserId?{recoveryDriverUserId}:{}),reason,resolution:selected}}));
  },
  cacheRun:async(run:FleetRun)=>{current();const saved=FleetRunSchema.parse(run);if(saved.companyId!==account.companyId)throw Error("Original Fleet run scope changed");await journal.putCache(`run:${saved.id}`,saved);},
  readRun:async(id:string)=>{const value=await journal.readCache(`run:${z.uuid().parse(id)}`);return value?FleetRunSchema.parse(value):null;},
  async evidencePage(activityId:string,cursor:string|null=null){current();const page=FleetWorkEvidencePageSchema.parse(await options.http(`/api/fleet/work/activities/${z.uuid().parse(activityId)}/evidence`,{scope,cursor}));if(page.evidence.some(row=>row.record.runId!==activityId||row.record.companyId!==account.companyId))throw Error("Evidence readback scope changed");return page;},
  async commercialReview(activityId:string,after?:string){current();const id=z.uuid().parse(activityId),page=FleetCommercialReviewSchema.parse(await options.http(`/api/fleet/work/activities/${id}/commercial-review`,{scope,after}));current();if(page.activityId!==id)throw Error("Commercial review readback scope changed");return page;},
  async captureOfficeReview(page:FleetCommercialReview,input:FleetOfficeReviewAction,timeZone:string){
   current();if(!page.canReview||page.billing?.context.vendorId!==account.companyId)throw Error("Current office commercial authority is required");
   const activity={type:"canonical" as const,kind:"activity" as const,id:page.activityId,version:page.activityVersion},ticket={type:"canonical" as const,kind:"ticket" as const,id:page.ticket.id,version:page.ticket.version};
   const payload=input.kind==="ticket.finalize"?{ticket,expectedVersion:page.ticket.version,finalizeDayMinimums:input.finalizeDayMinimums}:input.kind==="price.resolve"?{activity,ticket,expectedVersion:page.activityVersion,reason:input.reason}:input.kind==="quantity.review"?{activity,ticket,selections:input.selections}:{activity,ticket,expectedVersion:page.activityVersion,quantityReviews:input.quantityReviews,taxTreatment:input.taxTreatment,intervals:input.intervals,additionalCharges:input.additionalCharges};
   return execute(FleetWorkCommandSchema.parse({version:2,scope,operationId:options.uuid(),capturedAt:new Date().toISOString(),timeZone,dependencies:[],kind:input.kind,payload}));
  },
  async captureQuantity(run:FleetRun,raw:FleetReportedQuantityInput){
   current();if((!run.ticketReference&&!run.localWork)||run.companyId!==account.companyId||run.driverUserId!==account.userId||(run.resourceAssignment?.snapshot??run.localWork?.snapshot)?.detail.driverUserId!==account.userId)throw Error("Original own-driver quantity context is required");
   const input=FleetReportedQuantityInputSchema.parse(raw),capturedAt=new Date().toISOString();
   return execute(FleetWorkCommandSchema.parse({version:2,scope,operationId:options.uuid(),capturedAt,timeZone:run.schedule?.timezone??"UTC",dependencies:await dependenciesFor(run),kind:"quantity.record",payload:{...referencesFor(run),evidence:{...input,id:options.uuid(),capturedAt,recordedByUserId:account.userId}}}));
  },
  async captureEvidence(run:FleetRun,source:unknown,contentType:string,kind:"photo"|"scale"|"receipt"|"signature",notes:string){
   current();if(!journal.stageEvidence||!(run.resourceAssignment?.snapshot??run.localWork?.snapshot)||(!run.ticketReference&&!run.localWork)||run.companyId!==account.companyId||run.driverUserId!==account.userId)throw Error("Original own-driver evidence context is required");
   const operationId=options.uuid(),id=options.uuid(),capturedAt=new Date().toISOString();
   const dependencies=await dependenciesFor(run);
   await journal.stageEvidence(id,source,contentType,media=>({version:2,scope,operationId,capturedAt,timeZone:run.schedule?.timezone??"UTC",dependencies,kind:"evidence.stage",payload:{evidence:{type:"local",kind:"evidence",id},...referencesFor(run),kind,byteSize:media.byteSize,sha256:media.sha256,contentType:contentType as "image/jpeg",notes,assignment:(run.resourceAssignment?.snapshot??run.localWork!.snapshot)}}));
   return {operationId,localEvidenceId:id,canonicalApplied:false as const,durability:"durable" as const};
  },
  async captureCreate(raw:unknown){const input=CreateFleetRunSchema.parse(raw),sourceKey=`create-source:${input.operationId}`,priorSource=await journal.readCache(sourceKey),original=(await journal.readState()).entries.find(row=>row.command.operationId===input.operationId);
   if(priorSource&&JSON.stringify(priorSource)!==JSON.stringify(input))throw Error("Cannot change an original Fleet request; use a new operation");
   if(original){if(original.command.kind!=="activity.create"||!priorSource)throw Error("Retained original Fleet request needs recovery");return {...await execute(original.command),localActivityId:original.command.payload.activityId};}
   const preparation=await prepareCreate(input),command=buildFleetCreateIntent({scope,input,preparation,uuid:options.uuid,now:()=>new Date()});await journal.putCache(sourceKey,input);return {...await execute(command),localActivityId:command.payload.activityId};
  },
  async captureAction(run:FleetRun,raw:FleetActionInput,timeZone:string){const action=FleetActionInputSchema.parse(raw),original=(await journal.readState()).entries.find(row=>row.command.operationId===action.operationId);
   if(original){if(original.command.kind!=="activity.action"||JSON.stringify(original.command.payload.action)!==JSON.stringify(action))throw Error("Cannot change an original Fleet action");return execute(original.command);}
   const command=buildFleetActionIntent(scope,run,action,()=>new Date(),timeZone);command.dependencies=await dependenciesFor(run);return execute(command);
  },
 };
}
export type FleetWorkSession=NonNullable<Awaited<ReturnType<typeof openFleetWorkSession>>>;
