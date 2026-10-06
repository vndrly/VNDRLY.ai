import { describe, expect, it } from "vitest";
import { createCoordinatedPlan, eligiblePlanSteps, checkpointPlan, encodePlanDescription, decodePlanDescription } from "./coordinated-plan";
const identity = { userId: 10, organizationKey: "vendor:7" };
const steps = [{ id: "review", specialist: "Finn", toolNames: ["query_tickets"], dependsOn: [] }, { id: "brief", specialist: "V", toolNames: ["get_work_hub_briefing"], dependsOn: ["review"] }];
describe("coordinated work dependencies and resumed authorization", () => {
 it("only releases a dependent step after a verified result is saved", () => {
  const plan = createCoordinatedPlan(identity, steps);
  expect(eligiblePlanSteps(plan, identity, new Set(["query_tickets", "get_work_hub_briefing"])).map(s=>s.id)).toEqual(["review"]);
  const saved = checkpointPlan(plan, identity, 1, "review", { state: "completed", resultReferences: ["ticket:123"] });
  expect(saved.version).toBe(2);
  expect(eligiblePlanSteps(saved, identity, new Set(["query_tickets", "get_work_hub_briefing"])).map(s=>s.id)).toEqual(["brief"]);
 });
 it("refuses cross-company resume, stale updates, and missing completion evidence", () => {
  const plan = createCoordinatedPlan(identity, steps);
  expect(()=>eligiblePlanSteps(plan,{...identity,organizationKey:"vendor:8"},new Set())).toThrow("identity");
  expect(()=>checkpointPlan(plan,identity,0,"review",{state:"completed",resultReferences:["ticket:123"]})).toThrow("version");
  expect(()=>checkpointPlan(plan,identity,1,"review",{state:"completed",resultReferences:[]})).toThrow("evidence");
 });
 it("preserves failed work and refuses completed work or revoked tools as runnable", () => {
  let plan = createCoordinatedPlan(identity,steps);
  plan=checkpointPlan(plan,identity,1,"review",{state:"failed",resultReferences:[],detail:"Provider unavailable"});
  expect(eligiblePlanSteps(plan,identity,new Set(["query_tickets","get_work_hub_briefing"]))).toEqual([]);
  expect(eligiblePlanSteps(createCoordinatedPlan(identity,steps),identity,new Set(["get_work_hub_briefing"]))).toEqual([]);
 });
 it("rejects cycles and unknown prerequisite identifiers", () => {
  expect(()=>createCoordinatedPlan(identity,[{...steps[0],dependsOn:["brief"]},steps[1]])).toThrow("cycle");
  expect(()=>createCoordinatedPlan(identity,[{...steps[0],dependsOn:["missing"]}])).toThrow("prerequisite");
 });
 it("cannot complete a step whose prerequisites remain unfinished", () => {
  expect(()=>checkpointPlan(createCoordinatedPlan(identity,steps),identity,1,"brief",{state:"completed",resultReferences:["briefing:1"]})).toThrow("prerequisite");
 });
});

it("round-trips a saved plan and rejects changed identity or malformed persisted data", () => {
 const plan=createCoordinatedPlan(identity,steps);
 expect(decodePlanDescription(encodePlanDescription(plan),identity)).toEqual(plan);
 expect(()=>decodePlanDescription(encodePlanDescription(plan),{...identity,userId:11})).toThrow("identity");
 expect(()=>decodePlanDescription('{"schemaVersion":1}',identity)).toThrow();
 expect(()=>decodePlanDescription(JSON.stringify({...plan,steps:[{...plan.steps[0],state:"made_up"}]}),identity)).toThrow();
});

