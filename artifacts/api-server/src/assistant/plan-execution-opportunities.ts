import { z } from "zod/v4";
import { currentPlanExecutionAuthority } from "./plan-execution-authorization";
import { planExecutionFingerprint, planExecutionResultSchema, type PlanExecutionAuthorization, type PlanExecutionStep } from "./plan-execution";
import { PLAN_EXECUTION_OPPORTUNITY_INPUTS } from "./plan-execution-read-policy";
import { handleWorkdayOpportunityTool, workdayOpportunityAvailable, type WorkdayOpportunityName } from "./workday-opportunity-chatgpt";
export function createPlanOpportunityRead(overrides: { authorize?: typeof currentPlanExecutionAuthority; read?: typeof handleWorkdayOpportunityTool; now?: () => number } = {}) {
  const authorize = overrides.authorize ?? currentPlanExecutionAuthority, read = overrides.read ?? handleWorkdayOpportunityTool;
  return async (authorization: PlanExecutionAuthorization, step: PlanExecutionStep) => {
    if (step.adapter !== "authorized_read" || !Object.hasOwn(PLAN_EXECUTION_OPPORTUNITY_INPUTS, step.toolName) || !authorization.steps.some(saved => planExecutionFingerprint(saved) === planExecutionFingerprint(step))) throw Error("Opportunity read differs from approved step");
    const name = step.toolName as WorkdayOpportunityName, args = PLAN_EXECUTION_OPPORTUNITY_INPUTS[name].parse(step.arguments);
    const before = await authorize(authorization);
    if (!workdayOpportunityAvailable(name, before.session, before.scopes)) throw Error("Opportunity read unavailable");
    const output = z.record(z.string(), z.unknown()).parse(await read(name, args, before.session, before.scopes));
    const after = await authorize(authorization);
    if (!workdayOpportunityAvailable(name, after.session, after.scopes)) throw Error("Opportunity read revoked");
    const observedAt = z.iso.datetime().parse(output.observedAt);
    const age = (overrides.now ?? Date.now)() - Date.parse(observedAt);
    if (age < -5000 || age > 300000) throw Error("Opportunity observation is stale");
    const source = z.array(z.record(z.string(), z.unknown())).parse(name === "query_gate_staffing_candidates" ? output.candidates : output.opportunities);
    const keys = name === "query_gate_staffing_candidates" ? ["vendorPeopleId", "userId", "name", "qualificationState", "availability"] : ["jobId", "partnerId", "workTypeId", "title", "serviceMatch", "derivedRelationshipStatus", "complianceFloor", "geography", "deadlineState", "eligibleRecordedOpportunity", "capacity", "workerQualifications"];
    const records = source.slice(0, 20).map(row => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]).parse(row[key])])));
    const summary = () => JSON.stringify({ tool: name, observedAt, records, omittedFromSummary: source.length - records.length, partial: source.length > records.length || output.truncated === true || output.partial === true, limitation: "Recorded evidence only. No assignment, message, bid, award or physical readiness verified; at most 20 records in this summary." });
    // Keep literal text within the receipt bound and retain exact source IDs.
    while (summary().length > 7800 && records.length) records.pop();
    return planExecutionResultSchema.parse({ operationId: step.operationId, sourceReferences: [`query:${name}`, ...records.map(row => `${name === "query_gate_staffing_candidates" ? "vendor-person" : "hotlist-job"}:${z.number().int().positive().parse(row.vendorPeopleId ?? row.jobId)}`)], summary: summary() });
  };
}
