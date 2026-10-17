import {z} from "zod/v4";
import {FleetWorkCommandSchema,FleetWorkScopeSchema,FleetWorkReceiptSchema,FleetWorkMappingSchema,FleetWorkReferenceSchema,type FleetWorkReference,type FleetWorkCommand,type FleetWorkScope} from "./fleet-work";
const time=z.iso.datetime({offset:true});
export const FleetWorkJournalEntrySchema=z.object({command:FleetWorkCommandSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),sequence:z.number().int().positive(),delivery:z.object({state:z.enum(["pending","sending","outcome_unknown","retry_later","needs_reconciliation","denied","applied"]),attempts:z.number().int().nonnegative(),lastAttemptAt:time.nullable(),retryAt:time.nullable(),receipt:FleetWorkReceiptSchema.nullable()}).strict()}).strict();
export const FleetWorkStateSchema=z.object({version:z.literal(2),scope:FleetWorkScopeSchema,locked:z.boolean(),entries:z.array(FleetWorkJournalEntrySchema),mappings:z.array(FleetWorkMappingSchema)}).strict().superRefine((value,ctx)=>{
 const operations=new Set<string>(),sequences=new Set<number>(),mappings=new Set<string>();
 for(const entry of value.entries){
   if(operations.has(entry.command.operationId)||sequences.has(entry.sequence)||stable(entry.command.scope)!==stable(value.scope))ctx.addIssue({code:"custom",message:"Journal contains duplicate identities or mixed original scopes"});
   operations.add(entry.command.operationId);sequences.add(entry.sequence);
   const receipt=entry.delivery.receipt;
   if(receipt&&(receipt.operationId!==entry.command.operationId||receipt.fingerprint!==entry.fingerprint||stable(receipt.scope)!==stable(value.scope)))ctx.addIssue({code:"custom",message:"Journal receipt differs from its original command"});
   if(entry.delivery.state==="applied"&&(!receipt||!["applied","duplicate"].includes(receipt.status)))ctx.addIssue({code:"custom",message:"Applied work requires an actual canonical receipt"});
 }
 for(const mapping of value.mappings){const key=`${mapping.local.kind}:${mapping.local.id}`;if(mappings.has(key))ctx.addIssue({code:"custom",message:"Journal contains duplicate canonical mappings"});mappings.add(key);}
});
export type FleetWorkState=z.infer<typeof FleetWorkStateSchema>;
function stable(value:unknown):string{
 if(value===null||typeof value!=="object")return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
 const obj=value as Record<string,unknown>;
 return `{${Object.keys(obj).filter(key=>obj[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${stable(obj[key])}`).join(",")}}`;
}
/** Internal digest input; never render/log it because source intents are private. */
export const serializeFleetWorkCommand=(input:unknown)=>stable(FleetWorkCommandSchema.parse(input));
const sameScope=(a:FleetWorkScope,b:FleetWorkScope)=>stable(a)===stable(b);
export function createFleetWorkState(scope:unknown):FleetWorkState{return FleetWorkStateSchema.parse({version:2,scope,locked:false,entries:[],mappings:[]});}
export function appendFleetWorkIntent(input:FleetWorkState,command:unknown,fingerprint:string):FleetWorkState{
 const state=FleetWorkStateSchema.parse(input),value=FleetWorkCommandSchema.parse(command);
 if(state.locked||!sameScope(state.scope,value.scope))throw new Error("Original work scope is locked or changed");
 if(!/^[a-f0-9]{64}$/.test(fingerprint))throw new Error("A verified command digest is required");
 const prior=state.entries.find(row=>row.command.operationId===value.operationId);
 if(prior){if(prior.fingerprint!==fingerprint||serializeFleetWorkCommand(prior.command)!==serializeFleetWorkCommand(value))throw new Error("An operation cannot be reused with changed original facts");return state;}
 state.entries.push({command:value,fingerprint,sequence:state.entries.reduce((max,row)=>Math.max(max,row.sequence),0)+1,delivery:{state:"pending",attempts:0,lastAttemptAt:null,retryAt:null,receipt:null}});
 return state;
}
function update(input:FleetWorkState,operationId:string,work:(entry:FleetWorkState["entries"][number])=>void){const state=FleetWorkStateSchema.parse(input),entry=state.entries.find(row=>row.command.operationId===operationId);if(!entry)throw new Error("Original command not found");work(entry);return state;}
export function markFleetWorkSending(state:FleetWorkState,operationId:string,at:string){return update(state,operationId,entry=>{if(state.locked||!["pending","retry_later"].includes(entry.delivery.state))throw new Error("Verify the original receipt before sending again");entry.delivery={...entry.delivery,state:"sending",attempts:entry.delivery.attempts+1,lastAttemptAt:time.parse(at)};});}
export function markFleetWorkOutcomeUnknown(state:FleetWorkState,operationId:string){return update(state,operationId,entry=>{if(entry.delivery.state!=="sending")throw new Error("Only an attempted write can have an unknown outcome");entry.delivery.state="outcome_unknown";});}
export function fleetWorkReceiptLookups(state:FleetWorkState){if(state.locked)return [];return state.entries.filter(row=>["sending","outcome_unknown"].includes(row.delivery.state)).map(row=>({operationId:row.command.operationId,scope:FleetWorkScopeSchema.parse(row.command.scope),fingerprint:row.fingerprint}));}
const absenceSchema=z.object({operationId:z.uuid(),scope:FleetWorkScopeSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),found:z.literal(false),checkedAt:time}).strict();
export function applyFleetWorkReceiptAbsence(input:FleetWorkState,raw:unknown):FleetWorkState{
 const result=absenceSchema.parse(raw);
 return update(input,result.operationId,entry=>{
   if(input.locked||!sameScope(input.scope,result.scope)||entry.fingerprint!==result.fingerprint||!["sending","outcome_unknown"].includes(entry.delivery.state)||!entry.delivery.lastAttemptAt||Date.parse(result.checkedAt)<Date.parse(entry.delivery.lastAttemptAt))throw new Error("A current exact receipt lookup is required before retry");
   entry.delivery.state="pending";entry.delivery.retryAt=null;
 });
}
const refKey=(ref:Pick<FleetWorkReference,"kind"|"id">)=>`${ref.kind}:${ref.id}`;
function explicitLocalReferences(command:FleetWorkCommand){
 const refs:Extract<FleetWorkReference,{type:"local"}>[]=[];
 const queue:unknown[]=[command.payload];
 for(let index=0;index<queue.length;index++){
   const value=queue[index];if(!value||typeof value!=="object")continue;
   const parsed=FleetWorkReferenceSchema.safeParse(value);if(parsed.success&&parsed.data.type==="local"){refs.push(parsed.data);continue;}
   queue.push(...(Array.isArray(value)?value:Object.values(value)));
 }
 return refs;
}
function createdLocalReferences(command:FleetWorkCommand):Array<{type:"local";kind:FleetWorkReference["kind"];id:string}>{
 if(command.kind==="activity.create")return [{type:"local",kind:"activity",id:command.payload.activityId},...(command.payload.billing.choice==="new_ticket"&&command.payload.billing.ticket.type==="local"?[command.payload.billing.ticket]:[])];
 if(command.kind==="detail.save"&&command.payload.expectedVersion===0)return [{type:"local",kind:"detail",id:command.payload.detail.id}];
 if(command.kind==="rig_package.save"&&command.payload.expectedVersion===0)return [{type:"local",kind:"rig_package",id:command.payload.package.id}];
 if(command.kind==="run_order.save"&&command.payload.expectedVersion===0)return [{type:"local",kind:"run_order",id:command.payload.order.id}];
 if(command.kind==="location.save")return [{type:"local",kind:"location",id:command.payload.destination.id??command.operationId}];
 if(command.kind==="compliance.receive"&&command.payload.source.expectedVersion===0)return [{type:"local",kind:"evidence",id:command.payload.source.record.evidence.id}];
 if((command.kind==="evidence.stage"||command.kind==="compliance.document.stage")&&command.payload.evidence.type==="local")return [command.payload.evidence];
 return [];
}
export function applyFleetWorkReceipt(input:FleetWorkState,receipt:unknown):FleetWorkState{
 const state=FleetWorkStateSchema.parse(input),value=FleetWorkReceiptSchema.parse(receipt),entry=state.entries.find(row=>row.command.operationId===value.operationId);
 if(state.locked||!entry||!sameScope(state.scope,value.scope)||entry.fingerprint!==value.fingerprint)throw new Error("Receipt does not match the original scoped command");
 if(entry.delivery.state==="applied"&&!["applied","duplicate"].includes(value.status))throw new Error("A canonical applied receipt cannot be reversed");
 if(value.status==="applied"||value.status==="duplicate")for(const mapping of value.mappings){
   if(![...explicitLocalReferences(entry.command),...createdLocalReferences(entry.command)].some(ref=>refKey(ref)===refKey(mapping.local)))throw new Error("Receipt maps an identity absent from the original intent");
   const old=state.mappings.find(row=>row.local.kind===mapping.local.kind&&row.local.id===mapping.local.id);if(old&&stable(old.canonical)!==stable(mapping.canonical))throw new Error("A local identity cannot be rebound to another canonical result");if(!old)state.mappings.push(mapping);
 }
 entry.delivery={...entry.delivery,state:value.status==="duplicate"?"applied":value.status,receipt:value,retryAt:value.status==="retry_later"?value.retryAt:null};
 return state;
}
function group(command:FleetWorkCommand):string{
 const payload=command.payload;
 if(command.kind==="activity.create")return `activity:${command.payload.activityId}`;
 if("activity" in payload)return `activity:${payload.activity.id}`;
 if(command.kind==="workday.event")return `workday:${command.scope.userId}`;
 if(command.kind==="ticket.finalize")return `ticket:${command.payload.ticket.id}`;
 if(command.kind==="detail.save")return `detail:${command.payload.detail.id}`;
 if(command.kind==="rig_package.save")return `rig_package:${command.payload.package.id}`;
 if(command.kind==="run_order.save")return `run_order:${command.payload.order.id}`;
 if(command.kind==="location.save")return `location:${command.payload.destination.id??command.operationId}`;
 if(command.kind==="compliance.receive")return `source:${command.payload.source.record.evidence.id}`;
 if(command.kind==="compliance.document.stage")return `source:${command.payload.recordId}`;
 if(command.kind==="compliance.review")return `source:${command.payload.evidenceId}`;
 if(command.kind==="requirements.adopt")return `requirement:${command.payload.requirement.id}`;
 if(command.kind==="compliance.facts")return `facts:${command.payload.subject.kind}:${command.payload.subject.id}`;
 return command.operationId;
}
export function nextFleetWorkBatch(state:FleetWorkState,now:string):FleetWorkCommand[]{
 if(state.locked)return [];
 time.parse(now);
 const completed=new Set(state.entries.filter(row=>row.delivery.state==="applied").map(row=>row.command.operationId)),seen=new Set<string>(),result:FleetWorkCommand[]=[];
 for(const entry of [...state.entries].sort((a,b)=>a.sequence-b.sequence)){
   if(entry.delivery.state==="applied")continue;
   const key=group(entry.command);if(seen.has(key))continue;seen.add(key);
   if(!["pending","retry_later"].includes(entry.delivery.state)||entry.command.dependencies.some(id=>!completed.has(id))||(entry.delivery.retryAt&&Date.parse(entry.delivery.retryAt)>Date.parse(now)))continue;
   const created=new Set(createdLocalReferences(entry.command).map(refKey));
   if(explicitLocalReferences(entry.command).some(ref=>!created.has(refKey(ref))&&!state.mappings.some(mapping=>refKey(mapping.local)===refKey(ref))))continue;
   result.push(FleetWorkCommandSchema.parse(entry.command));
 }
 return result;
}
export function fleetWorkDependencyProblems(state:FleetWorkState){
 const entries=new Map(state.entries.map(row=>[row.command.operationId,row]));
 const problems=state.entries.flatMap(entry=>entry.command.dependencies.flatMap(id=>{const prior=entries.get(id);if(!prior)return [{operationId:entry.command.operationId,reason:"invalid_dependency"}];if(group(prior.command)===group(entry.command)&&prior.sequence>entry.sequence)return [{operationId:entry.command.operationId,reason:"activity_order_dependency"}];return [];}));
 const done=new Set<string>(),active=new Map<string,number>(),cycles=new Set<string>();
 for(const start of entries.keys()){
   if(done.has(start))continue;
   const stack=[{id:start,index:0}];active.set(start,0);
   while(stack.length){
     const frame=stack[stack.length-1],deps=entries.get(frame.id)!.command.dependencies;
     if(frame.index===deps.length){done.add(frame.id);active.delete(frame.id);stack.pop();continue;}
     const next=deps[frame.index++];if(!entries.has(next)||done.has(next))continue;
     if(active.has(next)){for(let i=active.get(next)!;i<stack.length;i++)cycles.add(stack[i].id);continue;}
     active.set(next,stack.length);stack.push({id:next,index:0});
   }
 }
 return [...problems,...[...cycles].map(operationId=>({operationId,reason:"dependency_cycle"}))];
}
export function lockFleetWorkScope(state:FleetWorkState):FleetWorkState{return {...FleetWorkStateSchema.parse(state),locked:true};}
