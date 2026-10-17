import {
 FleetWorkScopeSchema,FleetWorkCommandSchema,FleetWorkReceiptSchema,FleetWorkMappingSchema,
 type FleetWorkScope,type FleetWorkCommand,type FleetWorkReceipt,type FleetWorkJournal,
} from "./fleet-work";
import {
 createFleetWorkState,appendFleetWorkIntent,applyFleetWorkReceipt,applyFleetWorkReceiptAbsence,
 markFleetWorkSending,markFleetWorkOutcomeUnknown,recordFleetWorkLookupFailure,
 serializeFleetWorkCommand,FleetWorkJournalEntrySchema,FleetWorkStateSchema,nextFleetWorkBatch,
 type FleetWorkState,
} from "./fleet-work-state";
export type FleetJournalTransaction={get(kind:string,key:string):Promise<string|null>;set(kind:string,key:string,value:string):Promise<void>;values(kind:string):Promise<string[]>};
/** Native SQLCipher and browser IndexedDB adapters must resolve only after commit.
 * Originals are immutable individual rows, never a bounded aggregate or cache. */
export type FleetJournalStore={transaction<T>(work:(tx:FleetJournalTransaction)=>Promise<T>):Promise<T>};
export type DurableFleetWorkJournal=FleetWorkJournal&{
 readState():Promise<FleetWorkState>;nextBatch(at:string):Promise<FleetWorkCommand[]>;
 markSending(id:string,at:string):Promise<void>;markUnknown(id:string):Promise<void>;
 recordLookupFailure(id:string,at:string):Promise<void>;applyReceiptAbsence(value:unknown):Promise<void>;
 retainEvidence(id:string,metadata:unknown):Promise<void>;evidence():Promise<Array<{id:string;metadata:unknown}>>;
 putCache(id:string,value:unknown):Promise<void>;readCache(id:string):Promise<unknown|null>;
};
export function createDurableFleetWorkJournal(options:{scope:FleetWorkScope;storage:FleetJournalStore;digest:(value:string)=>Promise<string>;isCurrent:()=>boolean;now?:()=>Date}):DurableFleetWorkJournal{
 const scope=FleetWorkScopeSchema.parse(options.scope),identity=JSON.stringify(scope),now=options.now??(()=>new Date());
 const same=(value:FleetWorkScope)=>{if(JSON.stringify(FleetWorkScopeSchema.parse(value))!==identity)throw Error("Original work scope changed");};
 const current=()=>{if(!options.isCurrent())throw Error("Original work account is locked or changed");};
 const transact=<T>(work:(tx:FleetJournalTransaction)=>Promise<T>)=>{current();return options.storage.transaction(async tx=>{const prior=await tx.get("meta","scope");if(prior&&prior!==identity)throw Error("Journal belongs to another original scope");if(!prior)await tx.set("meta","scope",identity);const result=await work(tx);current();return result;});};
 const unlocked=async(tx:FleetJournalTransaction)=>{if(await tx.get("meta","locked")==="true")throw Error("Original work scope is locked");};
 const readState=()=>transact(async tx=>FleetWorkStateSchema.parse({version:2,scope,locked:await tx.get("meta","locked")==="true",entries:(await tx.values("entry")).map(value=>FleetWorkJournalEntrySchema.parse(JSON.parse(value))).sort((a,b)=>a.sequence-b.sequence),mappings:(await tx.values("mapping")).map(value=>FleetWorkMappingSchema.parse(JSON.parse(value)))}));
 const update=async(id:string,work:(state:FleetWorkState)=>FleetWorkState)=>transact(async tx=>{
  await unlocked(tx);const raw=await tx.get("entry",id);if(!raw)throw Error("Original command not found");
  const entry=FleetWorkJournalEntrySchema.parse(JSON.parse(raw)),mappings=(await tx.values("mapping")).map(value=>FleetWorkMappingSchema.parse(JSON.parse(value)));
  const result=work({...createFleetWorkState(scope),entries:[entry],mappings});
  await tx.set("entry",id,JSON.stringify(result.entries[0]));
  for(const mapping of result.mappings)await tx.set("mapping",`${mapping.local.kind}:${mapping.local.id}`,JSON.stringify(mapping));
 });
 const append=async(raw:FleetWorkCommand)=>{
  const command=FleetWorkCommandSchema.parse(raw);same(command.scope);current();const fingerprint=await options.digest(serializeFleetWorkCommand(command));
  await transact(async tx=>{
   await unlocked(tx);const prior=await tx.get("entry",command.operationId);
   if(prior){const entry=FleetWorkJournalEntrySchema.parse(JSON.parse(prior));if(entry.fingerprint!==fingerprint||serializeFleetWorkCommand(entry.command)!==serializeFleetWorkCommand(command))throw Error("An operation cannot be reused with changed original facts");return;}
   const next=Number(await tx.get("meta","sequence")??"0")+1;if(!Number.isSafeInteger(next)||next<1)throw Error("Journal sequence is invalid");
   const entry=appendFleetWorkIntent(createFleetWorkState(scope),command,fingerprint).entries[0];entry.sequence=next;
   await tx.set("entry",command.operationId,JSON.stringify(entry));await tx.set("meta","sequence",String(next));
  });
  return {operationId:command.operationId,storedAt:now().toISOString(),durability:"durable" as const,canonicalApplied:false as const};
 };
 return {
  append,appendFact:append,readState,nextBatch:async at=>nextFleetWorkBatch(await readState(),at),
  async listPending(value,after=0){same(value);const state=await readState(),entries=state.entries.filter(row=>row.sequence>after&&row.delivery.state!=="applied");const page=entries.slice(0,100);return {commands:page.map(row=>row.command),nextCursor:entries.length>100?page.at(-1)!.sequence:null};},
  async readMappings(value,ids){same(value);return (await readState()).mappings.filter(row=>ids.includes(String(row.local.id)));},
  async applyReceipt(value,raw){same(value);const receipt=FleetWorkReceiptSchema.parse(raw);same(receipt.scope);await update(receipt.operationId,state=>applyFleetWorkReceipt(state,receipt));},
  markSending:(id,at)=>update(id,state=>markFleetWorkSending(state,id,at)),markUnknown:id=>update(id,state=>markFleetWorkOutcomeUnknown(state,id)),
  recordLookupFailure:(id,at)=>update(id,state=>recordFleetWorkLookupFailure(state,id,at)),
  applyReceiptAbsence:async raw=>{const value=raw as {operationId:string};await update(value.operationId,state=>applyFleetWorkReceiptAbsence(state,raw));},
  async readStatus(value){same(value);const state=await readState();return {pending:state.entries.filter(row=>!["applied","needs_reconciliation","denied"].includes(row.delivery.state)).length,needsReconciliation:state.entries.filter(row=>["needs_reconciliation","denied"].includes(row.delivery.state)).length,pendingEvidence:state.entries.filter(row=>["evidence.stage","compliance.document.stage"].includes(row.command.kind)&&row.delivery.state!=="applied").length,locked:state.locked};},
  async lockScope(value){same(value);await transact(tx=>tx.set("meta","locked","true"));},
  async retainEvidence(id,metadata){await transact(async tx=>{await unlocked(tx);const raw=JSON.stringify({id,metadata}),prior=await tx.get("evidence",id);if(prior&&prior!==raw)throw Error("Original evidence metadata cannot be replaced");await tx.set("evidence",id,raw);});},
  evidence:()=>transact(async tx=>(await tx.values("evidence")).map(value=>JSON.parse(value) as {id:string;metadata:unknown})),
  putCache:(id,value)=>transact(async tx=>{await unlocked(tx);await tx.set("cache",id,JSON.stringify(value));}),
  readCache:id=>transact(async tx=>{const raw=await tx.get("cache",id);return raw===null?null:JSON.parse(raw) as unknown;}),
 };
}
