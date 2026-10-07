import { beforeEach, describe, expect, it, vi } from "vitest";
import { FleetRunSchema, previewFleetRunActions, type FleetOverview, type FleetActionInput } from "@workspace/api-zod";
const records = vi.hoisted(() => new Map<string, string>());
const failure = vi.hoisted(() => ({ suffix: "" }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only", getItemAsync: async (key: string) => records.get(key) ?? null, setItemAsync: async (key: string, value: string) => { if (failure.suffix && key.endsWith(failure.suffix)) throw new Error("Interrupted device write"); records.set(key, value); }, deleteItemAsync: async (key: string) => { records.delete(key); } }));
import { clearFleetOfflineOnSignOut, nativeFleetOffline } from "./fleet-offline-native";
import { fleetOfflineByteLength } from "./fleet-offline";
const scope = { userId: 1, companyId: 2, membershipId: 3, sessionVersion: 7 };
beforeEach(() => { records.clear(); failure.suffix = ""; });
describe("Fleet encrypted chunk storage", () => {
  it("retains the prior complete queue after an interrupted generation write and clears abandoned chunks", async () => {
    const first = { runId: "20000000-0000-4000-8000-000000000001", base: { runId: "20000000-0000-4000-8000-000000000001", companyId: 2, driverUserId: 1, vehicleAssetId: "30000000-0000-4000-8000-000000000001", trailerAssetId: null, version: 1 }, input: { action: "inspect", operationId: "10000000-0000-4000-8000-000000000001", expectedVersion: 1, notes: "Original inspection" } as FleetActionInput, capturedAt: "2026-10-07T12:00:00Z", state: "unsynced" as const };
    await nativeFleetOffline.enqueue(scope, first);
    failure.suffix = ".1.1";
    await expect(nativeFleetOffline.enqueue(scope, { ...first, runId: "20000000-0000-4000-8000-000000000002", base: { ...first.base, runId: "20000000-0000-4000-8000-000000000002" }, input: { ...first.input, operationId: "10000000-0000-4000-8000-000000000002", notes: "New report".repeat(100) } })).rejects.toThrow("Interrupted");
    expect((await nativeFleetOffline.read(scope)).actions).toEqual([{ ...first, sessionVersion: 7 }]);
    failure.suffix = "";
    await clearFleetOfflineOnSignOut();
    expect(records.size).toBe(0);
  });
  it("uses bounded chunks and clears every indexed record on sign out", async () => {
    await nativeFleetOffline.enqueue(scope, { runId: "20000000-0000-4000-8000-000000000001", base: { runId: "20000000-0000-4000-8000-000000000001", companyId: 2, driverUserId: 1, vehicleAssetId: "30000000-0000-4000-8000-000000000001", trailerAssetId: null, version: 1 }, input: { action: "inspect", operationId: "10000000-0000-4000-8000-000000000001", expectedVersion: 1, notes: "中".repeat(1000) } as FleetActionInput, capturedAt: "2026-10-07T12:00:00Z", state: "unsynced" });
    expect(records.size).toBeGreaterThan(3);
    expect([...records.values()].every(value => fleetOfflineByteLength(value) < 2048)).toBe(true);
    expect((await nativeFleetOffline.read(scope)).actions[0].input.notes).toHaveLength(1000);
    await clearFleetOfflineOnSignOut();
    expect(records.size).toBe(0);
  });
  it("refuses oversized unicode records before writing any chunks", async () => {
    const item = (index: number) => ({ runId: `20000000-0000-4000-8000-${String(index).padStart(12,"0")}`, base: { runId: `20000000-0000-4000-8000-${String(index).padStart(12,"0")}`, companyId: 2, driverUserId: 1, vehicleAssetId: "30000000-0000-4000-8000-000000000001", trailerAssetId: null, version: 1 }, input: { action: "inspect", operationId: `10000000-0000-4000-8000-${String(index).padStart(12,"0")}`, expectedVersion: 1, notes: "中".repeat(2000) } as FleetActionInput, capturedAt: "2026-10-07T12:00:00Z", state: "unsynced" as const });
    let refused = false;
    for(let index=1;index<=64;index++){
      const saved=new Map(records);
      try { await nativeFleetOffline.enqueue(scope,item(index)); } catch(error) { expect(String(error)).toContain("64 KB"); expect(records).toEqual(saved); refused=true;break; }
    }
    expect(refused).toBe(true);
  });
});

function twoCycleDay(notes: string) {
  const uuid = (family:number,index:number) => `${family}0000000-0000-4000-8000-${String(index).padStart(12,"0")}`;
  const stops = ["pickup","delivery","pickup","delivery","return"].map((kind,index)=>({id:uuid(4,index+1),siteId:392+index,kind,sequence:index}));
  const run=FleetRunSchema.parse({id:uuid(2,1),fleetId:uuid(6,1),companyId:2,title:"Synthetic two-cycle hauling day",driverUserId:1,vehicleAssetId:uuid(3,1),trailerAssetId:uuid(3,2),siteIds:stops.map(stop=>stop.siteId),status:"dispatched",phase:null,version:1,stops,loads:[],inspections:[],records:[],events:[],currentStopId:null,visitedStopIds:[],linkedTicketId:null,allowedActions:["acknowledge"],labels:{driverName:"Synthetic Driver",vehicleName:"Synthetic Truck",trailerName:"Synthetic Trailer",sites:stops.map(stop=>({siteId:stop.siteId,name: `Synthetic stop ${stop.sequence+1}`}))}});
  const facts: Partial<FleetActionInput>[]=[{action:"acknowledge"},{action:"inspect",inspectionOutcome:"passed",notes},{action:"record_meter",reading:12000,unit:"miles",notes},{action:"start"}];
  facts.push({action:"pause",reason:"Stopped at a safe rest area"},{action:"resume"},{action:"record_fuel",quantity:40,unit:"gallons",notes});
  for(let cycle=0;cycle<2;cycle++){
    const pickup=stops[cycle*2],delivery=stops[cycle*2+1],loadId=uuid(5,cycle+1);
    facts.push({action:"arrive_stop",stopId:pickup.id},{action:"record_load",loadId,commodity:"Synthetic sand",quantity:25,unit:"tons",manifestReference:`SYN-MANIFEST-${cycle+1}`},{action:"depart_stop",stopId:pickup.id},{action:"arrive_stop",stopId:delivery.id},{action:"record_delivery",loadId,deliveryReference:`SYN-DELIVERY-${cycle+1}`},{action:"depart_stop",stopId:delivery.id});
  }
  facts.push({action:"record_fuel",quantity:20,unit:"gallons",notes},{action:"arrive_stop",stopId:stops[4].id},{action:"depart_stop",stopId:stops[4].id},{action:"record_meter",reading:12180,unit:"miles",notes},{action:"submit_closeout",notes});
  const base={runId:run.id,companyId:2,driverUserId:1,vehicleAssetId:run.vehicleAssetId,trailerAssetId:run.trailerAssetId,version:1};
  const actions=facts.map((fact,index)=>({base,runId:run.id,state:"unsynced" as const,sessionVersion:7,capturedAt:`2026-10-07T12:${String(index).padStart(2,"0")}:00Z`,input:{...fact,action:fact.action!,operationId:uuid(1,index+1),expectedVersion:index+1,capturedAt:`2026-10-07T12:${String(index).padStart(2,"0")}:00Z`,source:"user_report" as const}}));
  const overview: FleetOverview={accountScope:{userId:1,companyId:2,membershipId:3,sessionVersion:7},companyId:2,enabled:true,roles:["driver"],capabilities:{canDispatch:false,canManage:false,canDrive:true,canSetup:false},fleets:[],runs:[run],observations:[],unavailableIntegrations:["vehicle_telemetry","inspection_media","delivery_media"],generatedAt:"2026-10-07T12:00:00Z"};
  return {run,actions,overview};
}
it.each(["User reports equipment checked while stopped; readings and references copied from the physical documents. No media captured.", "中".repeat(2000)])("fits a complete24-entry two-cycle hauling day with cached assigned work and bounded capture notes",async(notes)=>{
  const day=twoCycleDay(notes);
  await nativeFleetOffline.cache(scope,day.overview);
  for(const action of day.actions)await nativeFleetOffline.enqueue(scope,action);
  const saved=await nativeFleetOffline.read(scope);
  expect(saved.actions).toHaveLength(24);
  const bytes=fleetOfflineByteLength(JSON.stringify(saved));
  expect(bytes).toBeLessThanOrEqual(64*1024);
  expect(previewFleetRunActions(day.run,saved.actions.map(action=>action.input))).toMatchObject({unsynced:true,expectedVersion:25,status:"submitted_for_review",visitedStopIds:day.run.stops.map(stop=>stop.id)});
  expect(saved.overview!.runs[0].status).toBe("dispatched");
  expect(saved.overview!.runs[0].events).toEqual([]);
});
it("makes maximum Unicode capture capacity explicit without losing any earlier queued fact",async()=>{
  const day=twoCycleDay("中".repeat(2000));
  const prefix=day.actions.slice(0,7);
  day.actions = [...prefix, ...Array.from({length:57},(_,index)=>({...prefix[6],input:{...prefix[6].input,operationId:`70000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,expectedVersion:index+8}}))];
  await nativeFleetOffline.cache(scope,day.overview);
  let refused=false;
  for(const action of day.actions){
    const before=await nativeFleetOffline.read(scope),chunks=new Map(records);
    try{await nativeFleetOffline.enqueue(scope,action);}catch(error){
      expect(String(error)).toContain("64 KB");
      expect(await nativeFleetOffline.read(scope)).toEqual(before);
      expect(records).toEqual(chunks);refused=true;break;
    }
  }
  expect(refused).toBe(true);
  expect((await nativeFleetOffline.read(scope)).actions.length).toBeLessThan(64);
});
