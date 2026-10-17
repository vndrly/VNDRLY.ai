import {WorkdayScopeSchema,WorkdayCommandSchema,WorkdaySnapshotSchema,WorkdayReceiptSchema,type WorkdayScope,type WorkdayCommand} from "./workday";
import type {FleetJournalStore,FleetJournalTransaction} from "./fleet-work-journal";
type Row={command:WorkdayCommand;sequence:number;state:"pending"|"sending"|"applied"|"held";reason:string|null};
export function createWorkdayController(options:{scope:WorkdayScope;storage:FleetJournalStore;isCurrent:()=>boolean;uuid:()=>string}){
 const scope=WorkdayScopeSchema.parse(options.scope),key=JSON.stringify(scope),current=()=>{if(!options.isCurrent())throw Error("Original workday account changed");};
 const transaction=<T>(work:(tx:FleetJournalTransaction)=>Promise<T>)=>{current();return options.storage.transaction(async tx=>{const result=await work(tx);current();return result;});};
 const category=`workday:${key}`;
 const read=()=>transaction(async tx=>{
  const cached=JSON.parse(await tx.get(category,"current")??"null") as {scope:WorkdayScope;workday:ReturnType<typeof WorkdaySnapshotSchema.parse>|null}|null;
  const commands=(await tx.values(`${category}:commands`)).map(value=>JSON.parse(value) as Row).sort((a,b)=>a.sequence-b.sequence);
  const pending=commands.filter(row=>row.state!=="applied"),last=pending.at(-1)?.command;
  return {scope,cached,commands,onShift:last?last.action!=="end_shift":!!cached?.workday&&cached.workday.summary.state!=="ended",pending:pending.length,held:pending.some(row=>row.state==="held")};
 });
 const cacheCurrent=async(raw:unknown)=>{const value=raw as {scope:unknown;workday:unknown};if(JSON.stringify(WorkdayScopeSchema.parse(value.scope))!==key)throw Error("Original workday account changed");const snapshot=WorkdaySnapshotSchema.nullable().parse(value.workday);if(snapshot&&(snapshot.workerUserId!==scope.userId||JSON.stringify(snapshot.owner)!==JSON.stringify(scope.owner)))throw Error("Original workday worker changed");await transaction(async tx=>{await tx.set(category,"current",JSON.stringify({scope,workday:snapshot}));await tx.set("workday-index","last-scope",key);});};
 const record=async(action:WorkdayCommand["action"],at:Date,timezone:string)=>{
  const state=await read();if(!state.cached)throw Error("Verify your employer before first offline shift");if(state.held)throw Error("Resolve the retained workday request before another change");if(action==="start_shift"&&state.onShift||action!=="start_shift"&&!state.onShift)throw Error("Workday transition is unavailable");
  const last=state.commands.filter(row=>row.state!=="applied").at(-1)?.command;
  const command=WorkdayCommandSchema.parse({scope,operationId:options.uuid(),shiftId:action==="start_shift"?options.uuid():last?.shiftId??state.cached.workday?.id,action,capturedAt:at.toISOString(),timezone:action==="start_shift"?timezone:last?.timezone??state.cached.workday?.timezone??timezone});
  await transaction(async tx=>{const sequence=Number(await tx.get(category,"sequence")??"0")+1;await tx.set(`${category}:commands`,command.operationId,JSON.stringify({command,sequence,state:"pending",reason:null}));await tx.set(category,"sequence",String(sequence));});return command;
 };
 const sync=async(transport:{read:(id:string)=>Promise<unknown>;send:(command:WorkdayCommand)=>Promise<unknown>})=>{
  for(const original of (await read()).commands.filter(row=>row.state!=="applied")){
   if(original.state==="held")break;const row={...original};let raw:unknown;
   try{current();if(row.state==="sending"){try{raw=await transport.read(row.command.operationId);}catch(error){if(!error||typeof error!=="object"||!("status" in error)||error.status!==404)throw error;raw=null;}}
    if(!raw){row.state="sending";await transaction(tx=>tx.set(`${category}:commands`,row.command.operationId,JSON.stringify(row)));raw=await transport.send(row.command);}current();
    const receipt=WorkdayReceiptSchema.parse(raw);if(receipt.operationId!==row.command.operationId||receipt.shiftId!==row.command.shiftId||receipt.event.workerUserId!==scope.userId||JSON.stringify(receipt.event.owner)!==JSON.stringify(scope.owner)||receipt.event.kind!==row.command.action||receipt.event.capturedAt!==row.command.capturedAt)throw Error("Workday receipt differs from original intent");
    await transaction(async tx=>{await tx.set(`${category}:commands`,row.command.operationId,JSON.stringify({...row,state:"applied"}));await tx.set(category,"current",JSON.stringify({scope,workday:{id:receipt.shiftId,version:receipt.version,owner:scope.owner,workerUserId:scope.userId,timezone:row.command.timezone,summary:receipt.summary}}));});
   }catch(error){current();if(error&&typeof error==="object"&&"status" in error&&Number(error.status)>=400&&Number(error.status)<500){await transaction(tx=>tx.set(`${category}:commands`,row.command.operationId,JSON.stringify({...row,state:"held",reason:"Current authority or workday changed; original retained"})));}break;}
  }
  return read();
 };
 return {read,record,cacheCurrent,sync};
}
