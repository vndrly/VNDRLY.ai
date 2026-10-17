import {it,expect,vi} from "vitest";import {randomUUID,createHash} from "node:crypto";
import * as session from "./fleet-work-session";
import {createDurableFleetWorkJournal,type FleetJournalStore} from "./fleet-work-journal";
it("opens only the original verified account and appends before transport, retaining unknown outcomes through restart",async()=>{
 const rows=new Map<string,string>(),storage:FleetJournalStore={transaction:async work=>work({get:async(k,id)=>rows.get(`${k}:${id}`)??null,set:async(k,id,v)=>{rows.set(`${k}:${id}`,v)},values:async k=>[...rows].filter(([key])=>key.startsWith(`${k}:`)).map(([,v])=>v)})};
 const account={userId:2,companyId:7,membershipId:3,sessionVersion:1},scope={owner:{type:"vendor" as const,id:7},userId:2,membershipId:3,sessionVersion:1,deviceId:randomUUID(),provisioningId:randomUUID()};
 const journal=createDurableFleetWorkJournal({scope,storage,isCurrent:()=>true,digest:async s=>createHash("sha256").update(s).digest("hex")});
 const http=vi.fn(async(path:string)=>{if(path.endsWith("capabilities"))return {enabled:true};if(path.endsWith("devices/register"))return {id:scope.deviceId};if(path.endsWith("provision"))return {scope,expiresAt:"2026-10-24T18:00:00Z"};if(path.includes("operations/"))return {receipt:null,checkedAt:new Date().toISOString()};if(path.endsWith("commands")){expect((await journal.readState()).entries).toHaveLength(1);throw Error("offline");}throw Error("Unexpected route");});
 const options={account,index:storage,openJournal:async()=>journal,isCurrent:()=>true,http,uuid:()=>scope.deviceId};
 const client=await session.openFleetWorkSession(options);expect(client).not.toBeNull();
 const command={version:2 as const,scope,operationId:randomUUID(),kind:"activity.note" as const,capturedAt:new Date().toISOString(),timeZone:"UTC",dependencies:[],payload:{activity:{type:"canonical" as const,kind:"activity" as const,id:randomUUID(),version:1},ticket:{type:"canonical" as const,kind:"ticket" as const,id:12,version:1},notes:"Original report"}};
 expect(await client!.execute(command)).toMatchObject({state:"outcome_unknown",canonicalApplied:false});
 const reopened=await session.openFleetWorkSession(options);await reopened!.synchronize();expect(http.mock.calls.some(([path])=>path.includes("operations/"))).toBe(true);expect((await journal.readState()).entries[0].command).toEqual(command);
 const foreign={...options,account:{...account,userId:999}};await expect(session.openFleetWorkSession(foreign)).rejects.toThrow("scope");
});
