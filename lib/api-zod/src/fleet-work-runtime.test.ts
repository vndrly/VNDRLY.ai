import {it,expect,vi} from "vitest";
import {createDurableFleetWorkJournal,type FleetJournalStore} from "./fleet-work-journal";
import {synchronizeFleetWork} from "./fleet-work-runtime";
import {randomUUID,createHash} from "node:crypto";
import {FleetWorkCommandSchema} from "./fleet-work";
it("reads office dispositions for dependency-held originals without replaying physical commands",async()=>{
 const scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()},rows=new Map<string,string>();
 const storage:FleetJournalStore={async transaction(work){return work({get:async(k,id)=>rows.get(`${k}:${id}`)??null,set:async(k,id,v)=>{rows.set(`${k}:${id}`,v)},values:async k=>[...rows].filter(([id])=>id.startsWith(`${k}:`)).map(([,v])=>v)});}};
 const journal=createDurableFleetWorkJournal({scope,storage,isCurrent:()=>true,digest:async v=>createHash("sha256").update(v).digest("hex")});
 const parent=FleetWorkCommandSchema.parse({version:2,scope,operationId:randomUUID(),kind:"activity.note",capturedAt:"2026-10-16T18:00:00Z",timeZone:"UTC",dependencies:[],payload:{activity:{type:"local",kind:"activity",id:randomUUID()},ticket:{type:"local",kind:"ticket",id:randomUUID()},notes:"Original closed report"}}),child={...parent,operationId:randomUUID(),dependencies:[parent.operationId]};await journal.append(parent);await journal.append(child);
 const state=await journal.readState(),caseId=randomUUID(),officeOperationId=randomUUID(),receipt=(operationId:string)=>({version:2 as const,scope,operationId,fingerprint:state.entries.find(e=>e.command.operationId===operationId)!.fingerprint,recordedAt:"2026-10-16T18:02:00Z",status:"retained" as const,reason:"changed_assignment" as const,caseId,resolution:{caseId,officeOperationId,reviewedByUserId:99,reason:"Original reports adopted separately for office billing review"}});
 await journal.applyReceipt(scope,receipt(parent.operationId));const apply=vi.fn(),lookup=vi.fn(async(command:typeof parent)=>({receipt:receipt(command.operationId),checkedAt:"2026-10-16T18:03:00Z"}));
 await synchronizeFleetWork(scope,{journal,isCurrent:()=>true,transport:{apply,lookup}});expect((await journal.readState()).entries.map(e=>e.delivery.state)).toEqual(["retained","retained"]);expect(apply).not.toHaveBeenCalled();expect(lookup).toHaveBeenCalledWith(child);
});
it("recovers a lost committed response before replay and lets independent work continue",async()=>{
 const scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()},rows=new Map<string,string>();
 const storage:FleetJournalStore={async transaction(work){const copy=new Map(rows);const result=await work({get:async(k,id)=>copy.get(`${k}:${id}`)??null,set:async(k,id,v)=>{copy.set(`${k}:${id}`,v)},values:async k=>[...copy].filter(([id])=>id.startsWith(`${k}:`)).map(([,v])=>v)});rows.clear();for(const [k,v]of copy)rows.set(k,v);return result;}};
 const journal=createDurableFleetWorkJournal({scope,storage,isCurrent:()=>true,digest:async v=>createHash("sha256").update(v).digest("hex")});
 const command=FleetWorkCommandSchema.parse({version:2,scope,operationId:randomUUID(),kind:"activity.note",capturedAt:"2026-10-16T18:00:00Z",timeZone:"UTC",dependencies:[],payload:{activity:{type:"canonical",kind:"activity",id:randomUUID(),version:1},ticket:{type:"canonical",kind:"ticket",id:12,version:1},notes:"Original report"}});
 await journal.append(command);let receipt:any=null;
 const apply=vi.fn(async c=>{receipt={version:2,operationId:c.operationId,scope,fingerprint:(await journal.readState()).entries[0].fingerprint,recordedAt:"2026-10-16T18:01:00Z",status:"applied",mappings:[],canonicalReferences:[]};throw Error("Response lost after commit");});
 const lookup=vi.fn(async()=>({receipt,checkedAt:"2026-10-16T18:02:00Z"}));
 const options={journal,isCurrent:()=>true,transport:{apply,lookup},now:()=>new Date("2026-10-16T18:02:00Z")};
 await synchronizeFleetWork(scope,options);expect((await journal.readState()).entries[0].delivery.state).toBe("outcome_unknown");await synchronizeFleetWork(scope,options);expect(apply).toHaveBeenCalledTimes(1);expect(lookup).toHaveBeenCalledTimes(1);expect((await journal.readState()).entries[0].delivery.state).toBe("applied");
});
it("uses an authenticated absent receipt to allow retry without a locally fabricated acknowledgement",async()=>{
 const scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()},rows=new Map<string,string>();
 const storage:FleetJournalStore={async transaction(work){return work({get:async(k,id)=>rows.get(`${k}:${id}`)??null,set:async(k,id,v)=>{rows.set(`${k}:${id}`,v)},values:async k=>[...rows].filter(([id])=>id.startsWith(`${k}:`)).map(([,v])=>v)});}};
 const journal=createDurableFleetWorkJournal({scope,storage,isCurrent:()=>true,digest:async v=>createHash("sha256").update(v).digest("hex")});const command=FleetWorkCommandSchema.parse({version:2,scope,operationId:randomUUID(),kind:"activity.note",capturedAt:"2026-10-16T18:00:00Z",timeZone:"UTC",dependencies:[],payload:{activity:{type:"canonical",kind:"activity",id:randomUUID(),version:1},ticket:{type:"canonical",kind:"ticket",id:12,version:1},notes:"Original report"}});await journal.append(command);await journal.markSending(command.operationId,"2026-10-16T18:01:00Z");let calls=0;
 await synchronizeFleetWork(scope,{journal,isCurrent:()=>true,now:()=>new Date("2026-10-16T18:03:00Z"),transport:{lookup:async()=>({receipt:null,checkedAt:"2026-10-16T18:02:00Z"}),apply:async()=>{calls++;throw Error("offline");}}});expect(calls).toBe(1);
});

it("deposits held descendants privately once without turning retention into canonical execution",async()=>{
 const scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()},rows=new Map<string,string>();
 const storage:FleetJournalStore={async transaction(work){return work({get:async(k,id)=>rows.get(`${k}:${id}`)??null,set:async(k,id,v)=>{rows.set(`${k}:${id}`,v)},values:async k=>[...rows].filter(([id])=>id.startsWith(`${k}:`)).map(([,v])=>v)});}};
 const journal=createDurableFleetWorkJournal({scope,storage,isCurrent:()=>true,digest:async v=>createHash("sha256").update(v).digest("hex")});
 const make=(dependencies:string[]=[])=>FleetWorkCommandSchema.parse({version:2,scope,operationId:randomUUID(),kind:"activity.note",capturedAt:"2026-10-16T18:00:00Z",timeZone:"UTC",dependencies,payload:{activity:{type:"canonical",kind:"activity",id:randomUUID(),version:1},ticket:{type:"canonical",kind:"ticket",id:12,version:1},notes:"Original physical observation"}});
 const parent=make(),children=[make([parent.operationId]),make([parent.operationId])];
 for(const command of [parent,...children])await journal.append(command);
 const parentEntry=(await journal.readState()).entries[0];
 await journal.applyReceipt(scope,{version:2,scope,operationId:parent.operationId,fingerprint:parentEntry.fingerprint,recordedAt:"2026-10-16T18:01:00Z",status:"needs_reconciliation",reason:"changed_assignment",caseId:randomUUID()});
 const retained:string[]=[],apply=vi.fn(async()=>{throw Error("Must not execute held descendants");});let invalid=true;
 const retain=vi.fn(async(command:typeof parent)=>({version:2 as const,scope,operationId:command.operationId,fingerprint:invalid?"f".repeat(64):(await journal.readState()).entries.find(row=>row.command.operationId===command.operationId)!.fingerprint,status:"retained_for_review" as const,retainedAt:"2026-10-16T18:02:00Z",canonicalApplied:false as const}));
 const options={journal,isCurrent:()=>true,limit:2,transport:{apply,lookup:vi.fn(),retain}};
 await synchronizeFleetWork(scope,options);expect(await journal.readCache(`original-retention:${parent.operationId}`)).toBeNull();
 invalid=false;
 for(let i=0;i<3;i++)await synchronizeFleetWork(scope,{...options,transport:{...options.transport,retain:async command=>{retained.push(command.operationId);return retain(command);}}});
 expect(new Set(retained)).toEqual(new Set([parent.operationId,...children.map(row=>row.operationId)]));expect(retained).toHaveLength(3);expect(apply).not.toHaveBeenCalled();
 expect((await journal.readState()).entries.map(row=>row.delivery.state)).toEqual(["needs_reconciliation","pending","pending"]);
 const independent=make();await journal.append(independent);
 const independentEntry=(await journal.readState()).entries.at(-1)!;
 await synchronizeFleetWork(scope,{...options,transport:{...options.transport,retain:async()=>{throw Error("Private storage unavailable");},apply:async command=>({version:2 as const,scope,operationId:command.operationId,fingerprint:independentEntry.fingerprint,recordedAt:"2026-10-16T18:03:00Z",status:"applied" as const,mappings:[],canonicalReferences:[]})}});
 expect((await journal.readState()).entries.at(-1)!.delivery.state).toBe("applied");
 let current=true;const switched=vi.fn(async(command:typeof parent)=>{current=false;return retain(command);});
 await expect(synchronizeFleetWork(scope,{...options,limit:10,isCurrent:()=>current,transport:{...options.transport,retain:switched}})).rejects.toThrow("Original work account changed");
 expect(switched).toHaveBeenCalledTimes(1);
});
