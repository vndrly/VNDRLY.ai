import {fleetWorkReceiptLookups,type FleetWorkState} from "./fleet-work-state";
import {FleetWorkReceiptSchema,type FleetWorkScope,type FleetWorkCommand,type FleetWorkReceipt} from "./fleet-work";
import type {DurableFleetWorkJournal} from "./fleet-work-journal";
export type FleetWorkTransport={lookup(command:FleetWorkCommand):Promise<{receipt:FleetWorkReceipt|null;checkedAt:string}>;apply(command:FleetWorkCommand):Promise<FleetWorkReceipt>};
const active=new Map<string,Promise<unknown>>();
/** Sending is durable BEFORE transport. A lost response or process death forces
 * exact original-scope receipt lookup before another attempt. */
export async function synchronizeFleetWork(scope:FleetWorkScope,options:{journal:DurableFleetWorkJournal;transport:FleetWorkTransport;isCurrent:()=>boolean;now?:()=>Date;limit?:number}){
 const key=JSON.stringify(scope);if(active.has(key))return active.get(key);
 const run=(async()=>{
  const {journal,transport}=options,now=options.now??(()=>new Date());
  const current=()=>{if(!options.isCurrent())throw Error("Original work account changed");};
  current();let state=await journal.readState();if(JSON.stringify(state.scope)!==key||state.locked)throw Error("Original work scope is locked or changed");
  let applied=0,held=0,unknown=0;
  for(const lookup of fleetWorkReceiptLookups(state,now().toISOString()).slice(0,options.limit??20)){
   const entry=state.entries.find(row=>row.command.operationId===lookup.operationId)!;
   try{current();const result=await transport.lookup(entry.command);current();if(result.receipt)await journal.applyReceipt(scope,FleetWorkReceiptSchema.parse(result.receipt));else {const {legacyRead:_legacy,...original}=lookup;await journal.applyReceiptAbsence({...original,found:false,checkedAt:result.checkedAt});}}
   catch{current();await journal.recordLookupFailure(entry.command.operationId,now().toISOString());unknown++;}
  }
  state=await journal.readState();
  const batch=(await journal.nextBatch(now().toISOString())).filter(command=>!["evidence.stage","compliance.document.stage"].includes(command.kind)).slice(0,options.limit??20);
  for(const command of batch){current();await journal.markSending(command.operationId,now().toISOString());
   try{const receipt=FleetWorkReceiptSchema.parse(await transport.apply(command));current();await journal.applyReceipt(scope,receipt);if(["applied","duplicate"].includes(receipt.status))applied++;else held++;}
   catch{current();await journal.markUnknown(command.operationId);unknown++;}
  }
  return {applied,held,unknown,...await journal.readStatus(scope)};
 })();active.set(key,run);try{return await run;}finally{if(active.get(key)===run)active.delete(key);}
}
