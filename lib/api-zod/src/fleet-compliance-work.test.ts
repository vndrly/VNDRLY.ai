import { it, expect } from "vitest";
import * as contracts from "./index";
import { createFleetComplianceSourceDraft } from "./fleet-compliance-intake";
const at="2026-10-16T18:00:00Z",vehicle="11111111-1111-4111-8111-111111111111";
const source={url:"https://www.ecfr.gov/current/title-49/part-387",section:"Synthetic reviewed work-scope fixture",reviewedAt:at,reviewedByUserId:7};
const rule={id:"work-policy",version:1,category:"insurance",label:"Reviewed scoped auto liability",subjectKinds:["carrier"],jurisdiction:"carrier",classification:"company",effectiveFrom:"2026-01-01T00:00:00Z",effectiveUntil:null,applicability:{anyOf:[{allOf:[]}]},renewalDays:null,dueSoonDays:30,source,coverage:{coverageType:"auto_liability",requiredLimitUSD:"750000",filingRequired:true}};
function fixture(){
 const draft=createFleetComplianceSourceDraft({id:"22222222-2222-4222-8222-222222222222",subject:{kind:"carrier",id:11},kind:"insurance",coverageType:"auto_liability",source:"PRIVATE policy",at});
 const evidence={...draft.evidence,status:"verified",verifiedAt:at,verifiedByUserId:7,validFrom:"2026-01-01T00:00:00Z",validUntil:"2027-01-01T00:00:00Z",requirementId:rule.id};
 const record={...draft,evidence,attributes:{kind:"insurance",coverage:{...(draft.attributes as any).coverage,policyNumber:"PRIVATE-123",insuredLegalEntity:"Synthetic Carrier LLC",state:"verified",reviewedAt:at,reviewedByUserId:7,validFrom:evidence.validFrom,validUntil:evidence.validUntil,carrierIds:[11],states:["OK","TX"],cargoCodes:["crude"],equipmentIds:[vehicle],scopesReviewed:true,limitUSD:"1000000",filingStatus:"accepted",filingVerifiedAt:at}}};
 return {members:[{subject:{kind:"carrier",id:11},facts:{}}],requirements:[rule],records:[record],at,work:{carrierId:11,equipmentIds:[vehicle],states:["OK","TX"],cargoCode:"crude",insuredLegalEntity:"Synthetic Carrier LLC",startAt:at,endAt:"2026-10-16T23:00:00Z",verified:true}};
}
function evaluate(input:unknown):any[]{const fn=(contracts as any).evaluateFleetWorkCompliance;expect(fn).toBeTypeOf("function");return fn(input);}
it("evaluates the independently reviewed legal entity and all route/equipment/cargo/window facts before declaring coverage green",()=>{
 const input=fixture(),result=evaluate(input);expect(result[0]).toMatchObject({status:"green",reasons:[]});
 for(const work of [{...input.work,insuredLegalEntity:"Other Carrier"},{...input.work,states:["OK","NM"]},{...input.work,cargoCode:"waste"},{...input.work,equipmentIds:["33333333-3333-4333-8333-333333333333"]},{...input.work,endAt:null}])expect(evaluate({...input,work})[0].status).toBe("red");
 expect(JSON.stringify(result)).not.toMatch(/PRIVATE|policyNumber|insuredLegalEntity|limitUSD|privateDocumentRef/);
});
it("keeps missing reviewed work scope or missing reviewed coverage requirements red even if a policy document is verified",()=>{
 const input=fixture();expect(evaluate({...input,work:{...input.work,verified:false}})[0].status).toBe("red");
 expect(evaluate({...input,work:{...input.work,states:null}})[0].status).toBe("red");
 const {coverage:_,...unconfigured}=rule;expect(evaluate({...input,requirements:[unconfigured]})[0].status).toBe("red");
});
it("retains due dates for requirements applying in a later route jurisdiction",()=>{
 const input=fixture();expect(evaluate({...input,requirements:[{...rule,dueSoonDays:365,applicability:{anyOf:[{allOf:[{fact:"state",operator:"eq",value:"TX"}]}]}}]})[0].dueSoon).toEqual([{requirementId:rule.id,dueAt:"2027-01-01T00:00:00Z"}]);
});
it("preserves earlier red snapshots after a later source revision and never copies private evidence into safe history",()=>{
 const input=fixture(),expired={...input.records[0],evidence:{...input.records[0].evidence,validUntil:at},attributes:{kind:"insurance",coverage:{...input.records[0].attributes.coverage,validUntil:at}}};
 const prior=evaluate({...input,records:[expired]}),serialized=JSON.stringify(prior);expect(prior[0].status).toBe("red");expect(evaluate(input)[0].status).toBe("green");expect(JSON.stringify(prior)).toBe(serialized);
});
