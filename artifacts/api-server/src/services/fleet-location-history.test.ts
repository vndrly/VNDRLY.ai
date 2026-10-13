import {describe,it,expect,vi} from "vitest";
import {FleetRunSchema,FleetLocationObservationSchema} from "@workspace/api-zod";
import type {PoolClient} from "pg";
import type {FleetState} from "./fleet-repository";
vi.mock("./fleet-repository",()=>({FleetError:class extends Error{constructor(public code:string,public status=409){super(code);}}}));
import {createFleetLocationOperations} from "./fleet-location";
const id=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`;
function fixture(){
 const run=FleetRunSchema.parse({id:id(1),fleetId:id(2),companyId:7,title:"Synthetic route",driverUserId:2,vehicleAssetId:id(3),trailerAssetId:null,siteIds:[9],status:"in_progress",phase:"en_route",version:1,stops:[{id:id(4),siteId:9,kind:"pickup",sequence:0}],loads:[],inspections:[],currentStopId:null,visitedStopIds:[],events:[],linkedTicketId:null,allowedActions:[]});
 const state:FleetState={version:1,enabled:true,fleets:[],grants:[],supportGrants:[],runs:[run],operations:[],preferences:[]},actor={userId:1,companyId:7,currentSiteIds:[9]};
 type Saved={vendorId:number;targetId:string;deviceId:string;assignment:string;observation:unknown};
 const records:Saved[]=[],consents=new Set(["2:synthetic-device"]);let permitted=true;
 const assignment=()=>JSON.stringify([run.id,run.companyId,run.driverUserId,run.vehicleAssetId,run.trailerAssetId]);
 const point=(seconds:number)=>FleetLocationObservationSchema.parse({runId:run.id,driverUserId:run.driverUserId,vehicleAssetId:run.vehicleAssetId,latitude:35,longitude:-97,accuracyMeters:10,recordedAt:new Date(Date.UTC(2026,0,1)+seconds*1000).toISOString(),receivedAt:"2026-01-01T01:00:00Z",source:"driver_phone",freshness:"recent",physicalProofVerified:false});
 const add=(seconds:number,overrides:Partial<Saved>={})=>records.push({vendorId:7,targetId:run.id,deviceId:"synthetic-device",assignment:assignment(),observation:point(seconds),...overrides});
 const query=vi.fn(async(sql:string,args:unknown[])=>{
  expect(sql).toContain("tool_output->>'assignment'=$3");expect(sql).toContain("EXISTS(SELECT 1 FROM location_consents");expect(sql).toContain("c.revoked_at IS NULL");expect(sql).toContain("c.device_id=a.tool_output->>'deviceId'");expect(sql).toContain("ORDER BY (tool_output->'observation'->>'recordedAt')::timestamptz ASC,id ASC LIMIT 5001");
  return{rows:records.filter(row=>row.vendorId===args[0]&&row.targetId===args[1]&&row.assignment===args[2]&&consents.has(`${(row.observation as {driverUserId:number}).driverUserId}:${row.deviceId}`)).sort((a,b)=>Date.parse((a.observation as {recordedAt:string}).recordedAt)-Date.parse((b.observation as {recordedAt:string}).recordedAt)).slice(0,5001).map(row=>({tool_output:row}))};
 });
 const client={query} as unknown as PoolClient;
 const service=createFleetLocationOperations(async(a,work)=>work(state,client),(_s,a,r,action)=>permitted&&action==="view"&&a.companyId===r.companyId&&a.currentSiteIds?.includes(9)===true,()=>new Date("2026-01-01T01:00:00Z"));
 return{run,state,actor,records,consents,point,add,query,service,revokeAuthority:()=>{permitted=false;}};
}
describe("permission-scoped Fleet recorded location history",()=>{
 it("rejects unknown runs, another company, revoked authority and removed site access before reading samples",async()=>{const f=fixture();await expect(f.service.history(f.actor,id(99))).rejects.toMatchObject({code:"fleet.run_not_found"});await expect(f.service.history({...f.actor,companyId:99},f.run.id)).rejects.toMatchObject({status:404});await expect(f.service.history({...f.actor,currentSiteIds:[]},f.run.id)).rejects.toMatchObject({status:404});f.revokeAuthority();await expect(f.service.history(f.actor,f.run.id)).rejects.toMatchObject({status:404});expect(f.query).not.toHaveBeenCalled();});
 it("filters exact current driver-device consent plus company/run and returns recorded-time order",async()=>{const f=fixture();f.add(60);f.add(0);f.add(30,{deviceId:"revoked-device"});f.add(40,{vendorId:99});f.add(50,{targetId:id(99)});const history=await f.service.history(f.actor,f.run.id);expect(history.points.map(p=>p.recordedAt)).toEqual([f.point(0).recordedAt,f.point(60).recordedAt]);expect(history.points.every(p=>p.source==="driver_phone"&&p.physicalProofVerified===false)).toBe(true);f.consents.clear();expect((await f.service.history(f.actor,f.run.id)).points).toEqual([]);expect(f.query.mock.calls[0][1]).toEqual([7,f.run.id,JSON.stringify([f.run.id,7,2,f.run.vehicleAssetId,null])]);});
 it("discards prior assignment snapshots and malformed observation data",async()=>{const f=fixture();f.add(0);f.run.vehicleAssetId=id(30);f.add(20);f.add(30,{observation:{...f.point(30),latitude:91}});f.add(40,{observation:{...f.point(40),runId:id(99)}});const history=await f.service.history(f.actor,f.run.id);expect(history.points).toHaveLength(1);expect(history.points[0].vehicleAssetId).toBe(id(30));});
 it("caps returned points at 5000 and explicitly reports truncation",async()=>{const f=fixture();for(let index=0;index<5002;index++)f.add(index);const history=await f.service.history(f.actor,f.run.id);expect(history.points).toHaveLength(5000);expect(history.truncated).toBe(true);expect(history.points[0].recordedAt).toBe(f.point(0).recordedAt);expect(history.points.at(-1)!.recordedAt).toBe(f.point(4999).recordedAt);});
 it("does not mark exactly 5000 samples truncated",async()=>{const f=fixture();for(let index=0;index<5000;index++)f.add(index);expect((await f.service.history(f.actor,f.run.id)).truncated).toBe(false);});
 it("returns stable user-reported event identity and human-readable labels",async()=>{const f=fixture();f.run.events=[{id:id(70),operationId:id(71),type:"arrive_stop",actorUserId:2,recordedAt:f.point(30).recordedAt,source:"user_report"}];expect((await f.service.history(f.actor,f.run.id)).events).toEqual([{id:id(70),recordedAt:f.point(30).recordedAt,label:"arrive stop"}]);});
});
