import { z } from "zod/v4";
import {
  FleetComplianceEvaluationInputSchema, FleetComplianceEvidenceSchema,
  fleetComplianceSubjectKey, type FleetComplianceFinding,
} from "./fleet-compliance";
import { FleetComplianceRecordSchema } from "./fleet-compliance-register";
import { FleetInsuranceWorkScopeSchema } from "./fleet-insurance";
import { evaluateFleetInsuranceCoverage } from "./fleet-insurance-evaluation";
import { evaluateFleetCompliance, projectFleetComplianceForPartner } from "./fleet-compliance-evaluator";
import { fleetComplianceSourceSupportsRequirement } from "./fleet-compliance-intake";

const workSchema=FleetInsuranceWorkScopeSchema.omit({coverageType:true,requiredLimitUSD:true,requirementReference:true,filingRequired:true,evaluatedAt:true}).extend({
  states:z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(60).nullable(),
  cargoCode:z.string().trim().min(1).max(100).nullable(),
  verified:z.boolean(),
});
const inputSchema=FleetComplianceEvaluationInputSchema.omit({evidence:true,facts:true}).extend({
  records:z.array(FleetComplianceRecordSchema),work:workSchema,
});
/** Pure safe checkpoint assessment. Work scope comes from separately reviewed
 * operating facts, never from the policy being tested or guessed route text. */
export function evaluateFleetWorkCompliance(input:unknown){
  const value=inputSchema.parse(input),states=value.work.states??[null],
    results=states.map(state=>evaluateFleetCompliance({
      facts:{},members:value.members.map(member=>({subject:member.subject,facts:{...member.facts,
        carrierId:value.work.carrierId,vehicleAssetId:value.work.equipmentIds[0],state,
        states:value.work.states,cargoCode:value.work.cargoCode}})),
      requirements:value.requirements,evidence:value.records.map(record=>{
        let evidence=record.evidence;
        const rule=value.requirements.find(row=>row.id===evidence.requirementId&&row.version===evidence.requirementVersion);
        if(rule&&(!rule.subjectKinds.includes(evidence.subject.kind)||!fleetComplianceSourceSupportsRequirement(record.attributes.kind,rule.category)))
          evidence={...evidence,status:evidence.status==="verified"?"reviewed":evidence.status};
        if(record.attributes.kind==="insurance"&&evidence.status==="verified"){
          const coverageRule=rule?.coverage;
          let qualified=false;
          if(value.work.verified&&value.work.states&&value.work.cargoCode&&coverageRule){
            const {verified:_verified,...scope}=value.work;
            const coverage=evaluateFleetInsuranceCoverage({work:{...scope,
              coverageType:coverageRule.coverageType,requiredLimitUSD:coverageRule.requiredLimitUSD,
              filingRequired:coverageRule.filingRequired,requirementReference:`${rule!.id}:${rule!.version}`,
              evaluatedAt:value.at},records:value.records.flatMap(row=>row.attributes.kind==="insurance"&&row.evidence.requirementId===rule!.id&&row.evidence.requirementVersion===rule!.version?[row.attributes.coverage]:[])});
            qualified=coverage.status==="green";
          }
          if(!qualified)evidence={...evidence,status:"reviewed"};
        }
        return FleetComplianceEvidenceSchema.parse(evidence);
      }),at:value.at,freshness:value.freshness,
    }));
  return value.members.map((member,index)=>{
    const first=results[0][index],findings=results.flatMap(rows=>rows[index].findings);
    if(!value.work.verified||!value.work.states||!value.work.cargoCode)findings.push({subject:member.subject,requirementId:"work_scope_unverified",requirementVersion:1,category:"other",reason:"unverified",explanation:"Work scope needs a current referenced review",evaluatedAt:value.at});
    const unique=new Map<string,FleetComplianceFinding>();
    for(const finding of findings)unique.set(`${fleetComplianceSubjectKey(finding.subject)}:${finding.requirementId}:${finding.requirementVersion}:${finding.reason}`,finding);
    const dueSoon=[...new Map(results.flatMap(rows=>rows[index].dueSoon).map(row=>[`${row.requirementId}:${row.dueAt}`,row])).values()];
    return projectFleetComplianceForPartner({...first,status:unique.size?"red":"green",findings:[...unique.values()],dueSoon});
  });
}
