import {expect,it,vi} from "vitest";
import {progressFleetEvidenceUpload,type FleetEvidencePending} from "./fleet-evidence-device";
const pending:FleetEvidencePending={account:{userId:1,companyId:609,membershipId:4,sessionVersion:0},runId:"20000000-0000-4000-8000-000000000001",vehicleAssetId:"30000000-0000-4000-8000-000000000001",trailerAssetId:null,asset:{uri:"file:///synthetic.jpg",contentType:"image/jpeg",size:100,sha256:"a".repeat(64)},input:{operationId:"10000000-0000-4000-8000-000000000001",evidenceId:"50000000-0000-4000-8000-000000000001",expectedVersion:4,kind:"signature",notes:"Synthetic supplied signature image"},upload:null,uploaded:false,finalized:false};
function fixture(){
 let stored=structuredClone(pending);const records:any[]=[];
 const result={...pending.input,runId:pending.runId,companyId:609,runVersion:5,stopId:null,loadId:null,size:100,contentType:"image/jpeg",sha256:pending.asset.sha256,recordedByUserId:1,recordedAt:"2026-10-07T12:00:00Z",capturedAt:null,source:"device_upload",physicalProofVerified:false,signatureIdentityVerified:false,fileUrl:`/api/fleet/runs/${pending.runId}/evidence/${pending.input.evidenceId}/file`};
 const run:any={id:pending.runId,companyId:609,driverUserId:1,vehicleAssetId:pending.vehicleAssetId,trailerAssetId:null,version:4,status:"acknowledged"};
 const deps={contextCurrent:vi.fn(()=>true),readCurrent:vi.fn(async()=>({account:pending.account,run})),readEvidence:vi.fn(async()=>({runId:pending.runId,evidence:records})),persist:vi.fn(async(value:FleetEvidencePending)=>{stored=structuredClone(value);}),reserve:vi.fn(async()=>({uploadURL:"https://vndrly.ai/api/storage/upload/70000000-0000-4000-8000-000000000001",objectPath:"/objects/uploads/70000000-0000-4000-8000-000000000001"})),put:vi.fn(async(_value:FleetEvidencePending)=>{}),finalize:vi.fn(async()=>{}),associate:vi.fn(async()=>result)};
 return {deps,run,result,records,stored:()=>stored};
}
it("associates only verified private bytes and retains unverified signature identity",async()=>{
 const {deps}=fixture();const value=await progressFleetEvidenceUpload(pending,deps);
 expect(deps.persist.mock.calls.map(call=>[call[0].uploaded,call[0].finalized])).toEqual([[false,false],[true,false],[true,true]]);
 expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining("/api/storage/upload/"));expect(deps.associate).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:4,objectPath:"/objects/uploads/70000000-0000-4000-8000-000000000001",operationId:pending.input.operationId}));
 expect(value.physicalProofVerified).toBe(false);expect(value.signatureIdentityVerified).toBe(false);
});
it("reuses the reserved URL and original descriptor after an unknown PUT",async()=>{
 const f=fixture();f.deps.put.mockRejectedValueOnce(new Error("PUT response lost"));await expect(progressFleetEvidenceUpload(pending,f.deps)).rejects.toThrow("lost");
 const original=f.stored();await progressFleetEvidenceUpload(original,f.deps);expect(f.deps.reserve).toHaveBeenCalledTimes(1);expect(f.deps.put.mock.calls[1][0].upload).toEqual(f.deps.put.mock.calls[0][0].upload);expect(f.deps.put.mock.calls[1][0].asset).toEqual(pending.asset);
});
it("resolves an accepted association after its response is lost without reupload or duplicate association",async()=>{
 const f=fixture();f.deps.associate.mockImplementation(async()=>{f.records.push(f.result);throw new Error("POST response lost");});await expect(progressFleetEvidenceUpload(pending,f.deps)).rejects.toThrow("lost");f.run.version=5;
 const result=await progressFleetEvidenceUpload(f.stored(),f.deps);expect(result.evidenceId).toBe(pending.input.evidenceId);expect(f.deps.put).toHaveBeenCalledTimes(1);expect(f.deps.associate).toHaveBeenCalledTimes(1);
});
it("never silently rebases captured evidence after another run revision",async()=>{
 const f=fixture();f.deps.put.mockImplementation(async()=>{f.run.version=5;});await expect(progressFleetEvidenceUpload(pending,f.deps)).rejects.toThrow("silently rebased");expect(f.deps.associate).not.toHaveBeenCalled();expect(f.stored().input.expectedVersion).toBe(4);
});
it.each(["session","equipment","context"])("refuses changed %s before upload",async change=>{
 const f=fixture();if(change==="session")f.deps.readCurrent.mockResolvedValue({account:{...pending.account,sessionVersion:1},run:f.run});if(change==="equipment")f.run.vehicleAssetId="30000000-0000-4000-8000-000000000002";if(change==="context")f.deps.contextCurrent.mockReturnValue(false);
 await expect(progressFleetEvidenceUpload(pending,f.deps)).rejects.toThrow("changed");expect(f.deps.reserve).not.toHaveBeenCalled();expect(f.deps.associate).not.toHaveBeenCalled();
});
it("does not treat same-operation metadata with different bytes as a saved result",async()=>{
 const f=fixture();f.records.push({...f.result,sha256:"b".repeat(64)});await expect(progressFleetEvidenceUpload(pending,f.deps)).rejects.toThrow("exact pending");expect(f.deps.associate).not.toHaveBeenCalled();
});
