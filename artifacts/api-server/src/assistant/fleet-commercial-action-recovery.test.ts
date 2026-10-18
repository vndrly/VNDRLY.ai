import {it,expect,vi} from "vitest";
import {recoverFleetCommercialAction} from "./fleet-commercial-action-recovery";
const hash="a".repeat(64),session={userId:3,vendorId:7,role:"vendor",membershipRole:"admin"} as any;
it("reads the original confirmed commercial result without repeating a mutation",async()=>{
 const action={toolName:"resolve_fleet_activity_price",tokenHash:hash,arguments:{runId:"11111111-1111-4111-8111-111111111111",expectedVersion:2,ticketVersion:1,reason:"Exact saved approval"}},request=vi.fn().mockImplementation(async(_path,_method,body)=>({verified:true,canonicalApplied:true,operationId:body.operationId,resources:[]}));
 expect(await recoverFleetCommercialAction(action,session,["fleet:billing"],request)).toMatchObject({verified:true});expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0]).toMatchObject(["/fleet/work/assistant/result","POST",{kind:"price.resolve",reason:"Exact saved approval"},session]);
 expect(await recoverFleetCommercialAction(action,session,["fleet:dispatch"],request)).toBeNull();expect(request).toHaveBeenCalledTimes(1);
 const known=vi.fn().mockImplementation(async(_path,_method,body)=>({verified:true,canonicalApplied:false,operationId:body.operationId,receipt:{status:"needs_reconciliation",caseId:"retained-original"}}));expect(await recoverFleetCommercialAction(action,session,["fleet:billing"],known)).toMatchObject({canonicalApplied:false,receipt:{status:"needs_reconciliation",caseId:"retained-original"}});
 const wrong=vi.fn().mockResolvedValue({verified:true,canonicalApplied:true,operationId:"11111111-1111-4111-8111-111111111111"});expect(await recoverFleetCommercialAction(action,session,["fleet:billing"],wrong)).toBeNull();
});
it("checks policy operation readback only under separate current policy consent",async()=>{
 const actor={userId:3,partnerId:9,role:"partner",membershipRole:"admin"} as any,action={toolName:"activate_fleet_compliance_policy",tokenHash:hash,arguments:{vendorId:7,expectedVersion:0,proposal:{policyId:null,mode:"enforced",scope:{partnerId:9,siteId:null,contractId:null,workTypeId:null},effectiveFrom:"2030-01-01T00:00:00Z",effectiveUntil:null,checkpoints:["office_submit"],notice:"Explicit future requirement",existingWorkTreatment:"preserve_capture_policy"}}},request=vi.fn().mockImplementation(async(path)=>({verified:true,receipt:{operationId:path.split("/").at(-1)}}));
 expect(await recoverFleetCommercialAction(action,actor,["fleet:billing"],request)).toBeNull();expect(request).not.toHaveBeenCalled();expect(await recoverFleetCommercialAction(action,actor,["fleet:policy"],request)).toMatchObject({verified:true});expect(request.mock.calls[0][0]).toContain("/fleet/compliance-policies/7/operations/");
});
