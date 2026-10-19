import {z} from "zod/v4";
import {FleetWorkScopeSchema} from "./fleet-work";
import {FleetComplianceSubjectSchema,FleetRequirementVersionSchema,FleetComplianceEvidenceSchema,fleetComplianceSubjectKey} from "./fleet-compliance";
import {FleetComplianceFactsSchema} from "./fleet-compliance-register";
import {evaluateFleetCompliance,projectFleetComplianceForDispatch} from "./fleet-compliance-evaluator";

/** Permission-scoped server projections only. No source documents, full license
 * identifiers, clinical records, or policy limits belong in this cache. B2
 * verifies provisioning; a parsed client cache is never an authority grant. */
export const FleetWorkComplianceCacheSchema=z.object({
 scope:FleetWorkScopeSchema.refine(scope=>scope.owner.type==="vendor","Fleet qualification cache requires a vendor owner"),receivedAt:z.iso.datetime({offset:true}),
 members:z.array(z.object({subject:FleetComplianceSubjectSchema,facts:FleetComplianceFactsSchema}).strict()).min(1),
 requirements:z.array(FleetRequirementVersionSchema),
 evidence:z.array(FleetComplianceEvidenceSchema.omit({source:true,privateDocumentRef:true}).strict()),
}).strict();
export function evaluateFleetWorkCachedCompliance(raw:unknown,rawScope:unknown,capturedAt:string){
 const cache=FleetWorkComplianceCacheSchema.parse(raw),scope=FleetWorkScopeSchema.parse(rawScope);
 if(JSON.stringify(cache.scope)!==JSON.stringify(scope))throw new Error("Cached qualification belongs to another original scope");
 z.iso.datetime({offset:true}).parse(capturedAt);
 const freshness=Date.parse(capturedAt)<Date.parse(cache.receivedAt)?"unverified":"cached";
 const assessments=evaluateFleetCompliance({facts:{carrierId:scope.owner.id},members:cache.members,requirements:cache.requirements,
   evidence:cache.evidence.map(row=>{
     const rule=cache.requirements.find(rule=>rule.id===row.requirementId&&rule.version===row.requirementVersion);
     // Generic safe metadata cannot certify work-specific policy coverage.
     return {...row,status:rule?.category==="insurance"&&row.status==="verified"?"reviewed":row.status,source:"Cached server operational projection",privateDocumentRef:null};
   }),at:capturedAt,freshness});
 const memberKeys=new Set(cache.members.map(row=>fleetComplianceSubjectKey(row.subject)));
 return {scope,receivedAt:cache.receivedAt,capturedAt,assessments:assessments.map(projectFleetComplianceForDispatch),
   evidenceReferences:cache.evidence.filter(row=>memberKeys.has(fleetComplianceSubjectKey(row.subject))).map(row=>({id:row.id,revision:row.revision}))};
}
