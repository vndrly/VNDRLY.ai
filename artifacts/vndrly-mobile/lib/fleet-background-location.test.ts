import { expect,it,vi } from "vitest";
import { deliverFleetBackgroundSample, type FleetBackgroundBinding } from "./fleet-background-location";
const account={userId:1,companyId:609,membershipId:4,sessionVersion:7};
const binding:FleetBackgroundBinding={account,runId:"20000000-0000-4000-8000-000000000001",vehicleAssetId:"30000000-0000-4000-8000-000000000001",trailerAssetId:null,deviceId:"synthetic-device",pending:null};
const sample={latitude:35,longitude:-97,accuracy:12,timestamp:Date.parse("2026-10-07T12:00:00Z")};
function fixture(){
 const run:any={id:binding.runId,companyId:609,driverUserId:1,vehicleAssetId:binding.vehicleAssetId,trailerAssetId:null,status:"in_progress",phase:"traveling_to_pickup",version:9};
 const deps={readCurrent:vi.fn(async()=>({account,run})),consent:vi.fn(async()=>true),permission:vi.fn(async()=>true),contextCurrent:vi.fn(()=>true),persist:vi.fn(async(_value:FleetBackgroundBinding)=>{}),operationId:()=>"10000000-0000-4000-8000-000000000001",post:vi.fn(async(input:any)=>({runId:binding.runId,vehicleAssetId:binding.vehicleAssetId,driverUserId:1,latitude:input.latitude,longitude:input.longitude,accuracyMeters:input.accuracyMeters,recordedAt:input.recordedAt,receivedAt:"2026-10-07T12:00:02Z",source:"driver_phone",freshness:"recent",physicalProofVerified:false}))};
 return {run,deps};
}
it("persists exact OS capture and UUID before POST, then clears only after verified acceptance",async()=>{
 const {deps}=fixture();const order:string[]=[];deps.persist.mockImplementation(async value=>{order.push(value.pending?"persist":"clear");});const post=deps.post.getMockImplementation()!;deps.post.mockImplementation(async input=>{order.push("post");return post(input);});
 const result=await deliverFleetBackgroundSample(binding,sample,deps);
 expect(order).toEqual(["persist","post","clear"]);expect(result.source).toBe("driver_phone");expect(result.physicalProofVerified).toBe(false);
 expect(deps.post).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:9,recordedAt:"2026-10-07T12:00:00.000Z",latitude:35,deviceId:"synthetic-device"}));
});
it("retries an immutable persisted report after a lost response instead of substituting a newer callback",async()=>{
 const first=fixture();first.deps.post.mockRejectedValue(new Error("offline"));
 await expect(deliverFleetBackgroundSample(binding,sample,first.deps)).rejects.toThrow("offline");
 const saved=first.deps.persist.mock.calls[0][0],next=fixture();next.run.version=10;
 await deliverFleetBackgroundSample(saved,{...sample,latitude:36,timestamp:sample.timestamp+10000},next.deps);
 expect(next.deps.post.mock.calls[0][0]).toEqual(first.deps.post.mock.calls[0][0]);
});
it.each(["paused","ended","assignment","session"])("refuses %s duty before persisting or sending",async change=>{
 const {run,deps}=fixture();if(change==="paused")run.phase="paused";if(change==="ended")run.status="completed";if(change==="assignment")run.vehicleAssetId="30000000-0000-4000-8000-000000000002";if(change==="session")deps.readCurrent.mockResolvedValue({account:{...account,sessionVersion:8},run});
 await expect(deliverFleetBackgroundSample(binding,sample,deps)).rejects.toThrow("refused");expect(deps.persist).not.toHaveBeenCalled();expect(deps.post).not.toHaveBeenCalled();
});
it("does not transmit if consent disappears after durable capture",async()=>{
 const {deps}=fixture();deps.consent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
 await expect(deliverFleetBackgroundSample(binding,sample,deps)).rejects.toThrow("reverified");expect(deps.persist).toHaveBeenCalledTimes(1);expect(deps.post).not.toHaveBeenCalled();
});
it("stops on a context change during persistence",async()=>{
 const {deps}=fixture();deps.persist.mockImplementation(async()=>{deps.contextCurrent.mockReturnValue(false);});
 await expect(deliverFleetBackgroundSample(binding,sample,deps)).rejects.toThrow("context changed");expect(deps.post).not.toHaveBeenCalled();
});
