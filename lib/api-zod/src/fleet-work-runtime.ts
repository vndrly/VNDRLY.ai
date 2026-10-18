import {fleetWorkReceiptLookups,type FleetWorkState} from "./fleet-work-state";
import {FleetWorkReceiptSchema,FleetWorkOriginalRetentionSchema,type FleetWorkOriginalRetention,type FleetWorkScope,type FleetWorkCommand,type FleetWorkReceipt} from "./fleet-work";
import type {DurableFleetWorkJournal} from "./fleet-work-journal";
export type FleetWorkTransport={lookup(command:FleetWorkCommand):Promise<{receipt:FleetWorkReceipt|null;checkedAt:string}>;apply(command:FleetWorkCommand):Promise<FleetWorkReceipt>;retain?:(command:FleetWorkCommand)=>Promise<FleetWorkOriginalRetention>};
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
  const attempted=new Set<string>(),limit=options.limit??20;
  while(attempted.size<limit){
   const batch=(await journal.nextBatch(now().toISOString())).filter(command=>!attempted.has(command.operationId)&&!["evidence.stage","compliance.document.stage"].includes(command.kind)).slice(0,limit-attempted.size);
   if(!batch.length)break;
   for(const command of batch){attempted.add(command.operationId);current();await journal.markSending(command.operationId,now().toISOString());
    try{const receipt=FleetWorkReceiptSchema.parse(await transport.apply(command));current();await journal.applyReceipt(scope,receipt);if(["applied","duplicate"].includes(receipt.status))applied++;else held++;}
    catch{current();await journal.markUnknown(command.operationId);unknown++;}
   }
  }
  // Held dependencies cannot enter the canonical execution queue. Deposit their
  // immutable source separately so authorized office recovery can inspect it.
  // A rotating bound prevents a failed oldest source from starving descendants.
  let retainedOriginals=0,retentionUnavailable=0;
  if(transport.retain){
   current();state=await journal.readState();
   const cursor=Number(await journal.readCache("original-retention-cursor")??0),ordered=[...state.entries.filter(row=>row.sequence>cursor),...state.entries.filter(row=>row.sequence<=cursor)];
   for(const entry of ordered.slice(0,limit)){
    current();const cacheKey=`original-retention:${entry.command.operationId}`,prior=FleetWorkOriginalRetentionSchema.safeParse(await journal.readCache(cacheKey));
    if(!(prior.success&&prior.data.fingerprint===entry.fingerprint&&prior.data.operationId===entry.command.operationId&&JSON.stringify(prior.data.scope)===key)){
     try{current();const saved=FleetWorkOriginalRetentionSchema.parse(await transport.retain(entry.command));current();
      if(saved.operationId!==entry.command.operationId||saved.fingerprint!==entry.fingerprint||JSON.stringify(saved.scope)!==key)throw Error("Original retention identity changed");
      await journal.putCache(cacheKey,saved);retainedOriginals++;
     }catch{current();retentionUnavailable++;}
    }
    current();await journal.putCache("original-retention-cursor",entry.sequence);
   }
  }
  return {applied,held,unknown,retainedOriginals,retentionUnavailable,...await journal.readStatus(scope)};
 })();active.set(key,run);try{return await run;}finally{if(active.get(key)===run)active.delete(key);}
}
