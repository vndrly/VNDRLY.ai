import { expect, it, vi } from "vitest";
import { createFleetPhoneLocationCollector } from "./fleet-phone-location";
const account={userId:1,companyId:2,membershipId:3,sessionVersion:1};
const run={id:"20000000-0000-4000-8000-000000000001",version:7,companyId:2,driverUserId:1,vehicleAssetId:"30000000-0000-4000-8000-000000000001",trailerAssetId:null,status:"in_progress",phase:"traveling_to_pickup"} as any;
const operationId="10000000-0000-4000-8000-000000000001";
function fixture(){
  const sample={latitude:35,longitude:-97,accuracy:15,timestamp:Date.parse("2026-10-07T12:00:00Z")};
  const observation={runId:run.id,vehicleAssetId:run.vehicleAssetId,driverUserId:1,latitude:35,longitude:-97,accuracyMeters:15,recordedAt:"2026-10-07T12:00:00.000Z",receivedAt:"2026-10-07T12:00:01Z",source:"driver_phone",freshness:"recent",physicalProofVerified:false};
  const deps={readCurrent:vi.fn(async()=>({account,run})),consent:vi.fn(async()=>true),permission:vi.fn(async()=>true),deviceId:vi.fn(async()=>"synthetic-device"),sample:vi.fn(async()=>sample),post:vi.fn(async(_input:any)=>observation),operationId:vi.fn(()=>operationId),contextCurrent:vi.fn(()=>true),changed:vi.fn()};
  return {deps,collector:createFleetPhoneLocationCollector(account,deps,run)};
}
it("sends an actual adapter sample with fresh server revision, device identity and phone-only source",async()=>{
  const {deps,collector}=fixture();collector.start();await collector.poll();
  expect(deps.post).toHaveBeenCalledWith({operationId,expectedVersion:7,deviceId:"synthetic-device",latitude:35,longitude:-97,accuracyMeters:15,recordedAt:"2026-10-07T12:00:00.000Z"});
  expect(collector.snapshot()).toMatchObject({state:"sharing",lastAccepted:{source:"driver_phone",physicalProofVerified:false}});
});
it.each(["paused","ended"])("never captures a phone sample when duty is %s",async kind=>{
  const {deps,collector}=fixture();deps.readCurrent.mockResolvedValue({account,run:{...run,...(kind==="paused"?{phase:"paused"}:{status:"completed"})}});collector.start();await collector.poll();
  expect(deps.sample).not.toHaveBeenCalled();expect(deps.post).not.toHaveBeenCalled();expect(collector.snapshot().state).toBe("stopped");
});
it("stops when device consent is revoked while the OS sample is being acquired",async()=>{
  const {deps,collector}=fixture();deps.consent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);collector.start();await collector.poll();
  expect(deps.sample).toHaveBeenCalledTimes(1);expect(deps.post).not.toHaveBeenCalled();expect(collector.snapshot().state).toBe("consent_required");
});
it("blocks capture without OS permission and stops sending after an account switch",async()=>{
  const denied=fixture();denied.deps.permission.mockResolvedValue(false);denied.collector.start();await denied.collector.poll();expect(denied.deps.sample).not.toHaveBeenCalled();
  const switched=fixture();switched.deps.sample.mockImplementation(async()=>{switched.deps.contextCurrent.mockReturnValue(false);return {latitude:35,longitude:-97,accuracy:15,timestamp:Date.parse("2026-10-07T12:00:00Z")};});switched.collector.start();await switched.collector.poll();expect(switched.deps.post).not.toHaveBeenCalled();expect(switched.collector.snapshot()).toMatchObject({state:"stopped",lastAccepted:null});
});
it("retains the exact UUID/sample after a dropped response rather than replacing its time or revision",async()=>{
  const {deps,collector}=fixture();deps.post.mockRejectedValueOnce(new Error("response lost"));collector.start();await collector.poll();deps.readCurrent.mockResolvedValue({account,run:{...run,version:8}});await collector.poll();
  expect(deps.post).toHaveBeenCalledTimes(2);expect(deps.post.mock.calls[1][0]).toEqual(deps.post.mock.calls[0][0]);expect(deps.sample).toHaveBeenCalledTimes(1);
});
it("stops on equipment reassignment or current-session revision refusal",async()=>{
  const changed=fixture();changed.collector.start();await changed.collector.poll();changed.deps.readCurrent.mockResolvedValue({account,run:{...run,vehicleAssetId:"30000000-0000-4000-8000-000000000002"}});await changed.collector.poll();expect(changed.deps.post).toHaveBeenCalledTimes(1);expect(changed.collector.snapshot().state).toBe("stopped");
  const refused=fixture();refused.deps.post.mockRejectedValue(Object.assign(new Error("version changed"),{status:409}));refused.collector.start();await refused.collector.poll();await refused.collector.poll();expect(refused.deps.post).toHaveBeenCalledTimes(1);expect(refused.collector.snapshot().state).toBe("stopped");
});
