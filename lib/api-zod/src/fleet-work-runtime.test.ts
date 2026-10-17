import {it,expect,vi} from "vitest";
import {createDurableFleetWorkJournal,type FleetJournalStore} from "./fleet-work-journal";
import {synchronizeFleetWork} from "./fleet-work-runtime";
import {randomUUID,createHash} from "node:crypto";
import {FleetWorkCommandSchema} from "./fleet-work";
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
