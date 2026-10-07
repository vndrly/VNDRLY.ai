import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { emptyFleetState, type FleetState } from "./fleet-repository";
import { createFleetLocationOperations } from "./fleet-location";

function fixture(){
 const run=FleetRunSchema.parse({id:randomUUID(),fleetId:randomUUID(),companyId:7,title:"Synthetic run",driverUserId:2,vehicleAssetId:randomUUID(),trailerAssetId:null,siteIds:[9],status:"in_progress",phase:"en_route",version:4,stops:[{id:randomUUID(),siteId:9,kind:"pickup",sequence:0}],loads:[],inspections:[],currentStopId:null,visitedStopIds:[],events:[],linkedTicketId:null,allowedActions:["pause"]});
 const state={...emptyFleetState(),enabled:true,runs:[run]};
 const actor: FleetActor={userId:2,companyId:7};
 let now=new Date("2026-10-07T12:00:00Z"),consent=true,authority=true;
 const operations=new Map<string,unknown>(),latest=new Map<string,unknown>();
 let writes=0;
 const client={query:async(sql:string,args:unknown[]=[])=>{
   if(sql.startsWith("SELECT id FROM location_consents"))return {rows:consent&&args[0]===2&&args[1]==="synthetic-device"?[{id:1}]:[]};
   if(sql.includes("target_type='fleet-location-operation'"))return {rows:operations.has(String(args[1]))?[{tool_output:operations.get(String(args[1]))}]:[]};
   if(sql.startsWith("INSERT INTO")){writes++;const target=args[2]==="fleet-location"?latest:operations;target.set(String(args[3]),JSON.parse(String(args[4])));return {rows:[]};}
   if(sql.startsWith("SELECT tool_output FROM ("))return {rows:consent?[...latest.values()].map(tool_output=>({tool_output})):[]};
   throw Error("Unexpected synthetic query");
 }} as unknown as PoolClient;
 const transaction=async<T>(bound:FleetActor,operation:(state:FleetState,client:PoolClient)=>Promise<T>)=>{bound.currentSiteIds=authority?[9]:[];return operation(state,client);};
 const service=createFleetLocationOperations(transaction,(_state,bound,current,action)=>bound.companyId===current.companyId&&bound.currentSiteIds?.includes(9)===true&&(action==="view"||bound.userId===current.driverUserId),()=>now);
 const input=()=>({operationId:randomUUID(),expectedVersion:4,deviceId:"synthetic-device",latitude:35,longitude:-97,accuracyMeters:12,recordedAt:now.toISOString()});
 return {run,actor,service,input,state,get writes(){return writes;},setConsent:(value:boolean)=>{consent=value;},setAuthority:(value:boolean)=>{authority=value;},advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
describe("Fleet device-reported location",()=>{
 it("uses transaction-refreshed authority, preserves run CAS and exact operation replay",async()=>{
   const f=fixture(),command=f.input();
   const saved=await f.service.record(f.actor,f.run.id,command);
   expect(saved).toMatchObject({source:"driver_phone",physicalProofVerified:false,accuracyMeters:12,freshness:"recent"});
   expect(f.run.version).toBe(4);
   await f.service.record(f.actor,f.run.id,command);expect(f.writes).toBe(2);
   await expect(f.service.record(f.actor,f.run.id,{...command,latitude:36})).rejects.toMatchObject({code:"fleet.location_operation_conflict"});
 });
 it("requires own active unpaused assignment, exact device consent and current authority",async()=>{
   const f=fixture();f.setConsent(false);
   await expect(f.service.record(f.actor,f.run.id,f.input())).rejects.toMatchObject({status:403});
   f.setConsent(true);f.run.phase="paused";
   await expect(f.service.record(f.actor,f.run.id,f.input())).rejects.toMatchObject({status:403});
   f.run.phase="en_route";f.setAuthority(false);
   await expect(f.service.record(f.actor,f.run.id,f.input())).rejects.toMatchObject({status:404});
   expect(f.writes).toBe(0);
 });
 it("refuses stale version, impossible capture time and out-of-range coordinates",async()=>{
   const f=fixture();
   await expect(f.service.record(f.actor,f.run.id,{...f.input(),expectedVersion:3})).rejects.toMatchObject({status:409});
   await expect(f.service.record(f.actor,f.run.id,{...f.input(),recordedAt:"2026-10-08T12:00:00Z"})).rejects.toMatchObject({code:"fleet.location_capture_time_invalid"});
   expect(()=>f.service.record(f.actor,f.run.id,{...f.input(),latitude:91})).toThrow();
   expect(f.writes).toBe(0);
 });
 it("labels unknown or low accuracy unavailable rather than a reliable live position",async()=>{
   const f=fixture();
   expect((await f.service.record(f.actor,f.run.id,{...f.input(),accuracyMeters:null})).freshness).toBe("unavailable");
   expect((await f.service.record(f.actor,f.run.id,{...f.input(),accuracyMeters:2000})).freshness).toBe("unavailable");
 });
 it("reprojects freshness and removes revoked, changed-assignment and ended positions",async()=>{
   const f=fixture();await f.service.record(f.actor,f.run.id,f.input());
   expect(await f.service.observations(f.actor)).toHaveLength(1);
   f.advance(7*60*1000);expect((await f.service.observations(f.actor))[0].freshness).toBe("stale");
   f.run.phase="paused";expect((await f.service.observations(f.actor))[0].freshness).toBe("paused");
   f.setConsent(false);expect(await f.service.observations(f.actor)).toEqual([]);
   f.setConsent(true);f.run.vehicleAssetId=randomUUID();expect(await f.service.observations(f.actor)).toEqual([]);
   f.run.status="completed";expect(await f.service.observations(f.actor)).toEqual([]);
 });
});
