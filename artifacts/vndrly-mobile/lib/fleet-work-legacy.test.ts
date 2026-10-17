import {it,expect} from "vitest";
import {FleetRunSchema,FleetWorkScopeSchema} from "@workspace/api-zod";
import {prepareFleetLegacyMigration} from "./fleet-offline";
const id=(n:number)=>`33333333-3333-4333-8333-${String(n).padStart(12,"0")}`,at="2026-10-16T18:00:00Z";
const scope=FleetWorkScopeSchema.parse({owner:{type:"vendor",id:11},userId:7,membershipId:9,sessionVersion:2,deviceId:"device",provisioningId:id(1)});
function fixture(){
 const run=FleetRunSchema.parse({id:id(2),fleetId:id(3),companyId:11,title:"Retained legacy activity",driverUserId:7,vehicleAssetId:id(4),trailerAssetId:null,siteIds:[13],status:"dispatched",phase:null,version:1,stops:[{id:id(5),siteId:13,kind:"delivery",sequence:0}],loads:[],inspections:[],currentStopId:null,visitedStopIds:[],events:[],linkedTicketId:123,allowedActions:[]});
 const action={sessionVersion:2,runId:run.id,base:{runId:run.id,companyId:11,driverUserId:7,vehicleAssetId:run.vehicleAssetId,trailerAssetId:null,version:1},input:{operationId:id(6),expectedVersion:1,action:"acknowledge",capturedAt:at,source:"user_report"},capturedAt:at,state:"unsynced"};
 return {version:1,scope:{userId:7,companyId:11,membershipId:9,sessionVersion:2},overview:{runs:[run]},cachedAt:"2026-10-16T17:00:00Z",actions:[action]};
}
it("prepares retained v1 actions without inventing a Detail or ticket revision and never authorizes deleting originals",()=>{
 const original=JSON.stringify(fixture()),plan=prepareFleetLegacyMigration(original,scope);expect(plan.phase).toBe("awaiting_durable_import");expect(plan.originalDocument).toBe(original);expect(plan.canDeleteOriginal).toBe(false);expect(plan.commands).toHaveLength(1);
 expect(plan.commands[0]).toMatchObject({kind:"activity.legacy_action",operationId:id(6),capturedAt:at,payload:{base:{runId:id(2),companyId:11,driverUserId:7,vehicleAssetId:id(4),version:1},ticket:{id:123,version:null,source:"legacy_cached_run_link"},action:{expectedVersion:1},legacyState:"unsynced"}});expect(plan.commands[0].payload).not.toHaveProperty("detailSnapshot");
});
it("retains unresolved legacy records while preparing unrelated valid records for durable import",()=>{
 const doc=fixture(),bad={...doc.actions[0],input:{...doc.actions[0].input,operationId:id(7)},sessionVersion:undefined};const plan=prepareFleetLegacyMigration(JSON.stringify({...doc,actions:[bad,doc.actions[0]]}),scope);expect(plan.commands).toHaveLength(1);expect(plan.recovery).toEqual([expect.objectContaining({sourceIndex:0,reason:"unverified_session"})]);expect(plan.canDeleteOriginal).toBe(false);
});
it("rejects a different account/company/membership and never rebinds old original sessions",()=>{
 const original=JSON.stringify(fixture());for(const changed of [{...scope,userId:8},{...scope,owner:{type:"vendor" as const,id:12}},{...scope,membershipId:10},{...scope,sessionVersion:3}])expect(()=>prepareFleetLegacyMigration(original,changed)).toThrow();expect(JSON.stringify(fixture())).toBe(original);
});
it("keeps missing ticket links and changed assignment snapshots for explicit recovery instead of fabricating IDs",()=>{
 const doc=fixture();for(const run of [{...doc.overview.runs[0],linkedTicketId:null},{...doc.overview.runs[0],vehicleAssetId:id(99)}]){
  const plan=prepareFleetLegacyMigration(JSON.stringify({...doc,overview:{runs:[run]}}),scope);expect(plan.commands).toEqual([]);expect(plan.recovery).toHaveLength(1);expect(plan.originalDocument).toContain('"operationId"');
 }
});
it("preserves definite legacy refusal state rather than recasting it as an ordinary network retry",()=>{
 const doc=fixture(),plan=prepareFleetLegacyMigration(JSON.stringify({...doc,actions:[{...doc.actions[0],state:"conflict",message:"Original assignment changed"}]}),scope);expect(plan.commands[0].payload.legacyState).toBe("conflict");expect(plan.commands[0].dependencies).toEqual([]);expect(plan.commands[0].payload.action.operationId).toBe(id(6));
});

it("durably imports originals once, verifies every operation and preserves unresolved records",async()=>{
 const {importFleetLegacyWork}=await import("./fleet-work-legacy");const {createDurableFleetWorkJournal}=await import("@workspace/api-zod");const {createHash}=await import("node:crypto");
 const rows=new Map<string,string>(),storage={transaction:async(work:any)=>work({get:async(k:string,id:string)=>rows.get(k+id)??null,set:async(k:string,id:string,value:string)=>{rows.set(k+id,value);},values:async(k:string)=>[...rows].filter(([key])=>key.startsWith(k)).map(([,value])=>value)})};
 const journal=createDurableFleetWorkJournal({scope,storage,isCurrent:()=>true,digest:async value=>createHash("sha256").update(value).digest("hex")}),document=JSON.stringify(fixture());
 expect(await importFleetLegacyWork(journal,document,scope,async value=>createHash("sha256").update(value).digest("hex"))).toMatchObject({imported:1,recovery:[],originalRetained:true});expect(await importFleetLegacyWork(journal,document,scope,async value=>createHash("sha256").update(value).digest("hex"))).toMatchObject({imported:1});expect((await journal.readState()).entries).toHaveLength(1);expect((await journal.readState()).entries[0].command.operationId).toBe(id(6));
 expect([...rows.values()].some(value=>value.includes('originalDocument'))).toBe(true);
});
