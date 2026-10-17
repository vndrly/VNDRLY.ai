import {it,expect} from "vitest";
import {randomUUID,createHash} from "node:crypto";
import {openFleetWorkSession} from "./fleet-work-session";
import {createDurableFleetWorkJournal,type FleetJournalStore} from "./fleet-work-journal";
import type {FleetRun} from "./fleet";

async function device(){
 const rows=new Map<string,string>(),storage:FleetJournalStore={transaction:async work=>work({get:async(k,id)=>rows.get(`${k}:${id}`)??null,set:async(k,id,v)=>{rows.set(`${k}:${id}`,v)},values:async k=>[...rows].filter(([key])=>key.startsWith(`${k}:`)).map(([,v])=>v)})};
 const account={userId:2,companyId:7,membershipId:3,sessionVersion:1},scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()};
 await storage.transaction(tx=>tx.set("work-session",JSON.stringify(account),JSON.stringify({scope,expiresAt:"2026-10-24T18:00:00Z"})));
 const journal=createDurableFleetWorkJournal({scope,storage,isCurrent:()=>true,digest:async s=>createHash("sha256").update(s).digest("hex")});
 const client=await openFleetWorkSession({account,index:storage,openJournal:async()=>journal,isCurrent:()=>true,uuid:randomUUID,http:async path=>{if(path.endsWith("capabilities"))return {enabled:true};throw Error("offline");}});
 const run={id:randomUUID(),companyId:7,driverUserId:2,version:4,ticketReference:{id:12,version:3},schedule:{timezone:"America/Chicago"},resourceAssignment:{snapshot:{detail:{driverUserId:2}}}} as unknown as FleetRun;
 return {client:client!,journal,run};
}
it("retains the driver's exact original quantity offline without endorsing it for billing",async()=>{
 const {client,journal,run}=await device();
 const result=await client.captureQuantity(run,{kind:"delivered",quantity:"123.456789",unit:"barrel",source:"manual",cycleId:null,evidenceReferences:["scale receipt 42"]});
 expect(result.canonicalApplied).toBe(false);
 const retained=(await journal.readState()).entries[0].command;
 expect(retained).toMatchObject({kind:"quantity.record",timeZone:"America/Chicago",payload:{activity:{id:run.id,version:4},ticket:{id:12,version:3},evidence:{kind:"delivered",quantity:"123.456789",recordedByUserId:2,source:"manual"}}});
 if(retained.kind!=="quantity.record")throw Error("Expected original quantity");
 expect(retained.payload.evidence.capturedAt).toBe(retained.capturedAt);
 expect(retained.payload.evidence).not.toHaveProperty("conversion");
 await client.synchronize();
 expect((await journal.readState()).entries[0].command).toEqual(retained);
});
it("refuses another driver's report and invented billable or converted authority before retaining any work",async()=>{
 const {client,journal,run}=await device(),input={kind:"delivered" as const,quantity:"1",unit:"barrel" as const,source:"manual" as const,cycleId:null,evidenceReferences:[]};
 await expect(client.captureQuantity({...run,driverUserId:99},input)).rejects.toThrow("own-driver");
 await expect(client.captureQuantity(run,{...input,kind:"billable"} as never)).rejects.toThrow();
 await expect(client.captureQuantity(run,{...input,source:"reviewed_conversion"} as never)).rejects.toThrow();
 await expect(client.captureQuantity(run,{...input,quantity:"1e3"})).rejects.toThrow();
 expect((await journal.readState()).entries).toHaveLength(0);
});
