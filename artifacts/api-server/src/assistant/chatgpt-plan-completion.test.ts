import { expect, it } from "vitest";
import { createCoordinatedPlan, encodePlanDescription } from "./coordinated-plan";
import { preparePlanCompletion } from "./chatgpt-plan-completion";
import { resumedWorkPlan } from "./chatgpt-coordinated-plan";
import { verifiedPlanCompletionIds } from "./plan-completion-proof";
const identity = { userId: 17, organizationKey: "vendor:4" }, owner = { type: "vendor" as const, id: 4 }, now = Date.parse("2030-01-01T12:00:00Z"), secret = "isolated-test-secret";
function setup() {
 const plan = createCoordinatedPlan(identity, [{ id: "read", specialist: "Finn", toolNames: ["query_tickets"], dependsOn: [], completion: { kind: "planned_read_observed" } }, { id: "next", specialist: "V", toolNames: ["get_work_hub_briefing"], dependsOn: ["read"] }]);
 const task = { id: "11111111-1111-4111-8111-111111111111", ownerOrgType: "vendor", ownerOrgId: 4, version: 3, status: "in_progress", description: encodePlanDescription(plan) };
 const input = { taskId: task.id, expectedTaskVersion: 3, stepId: "read", receipt: "verified-server-envelope" };
 const receipt = { kind: "plan-read-checkpoint", id: "22222222-2222-4222-8222-222222222222", userId: 17, organizationKey: identity.organizationKey, taskId: task.id, taskVersion: 3, planVersion: 1, stepId: "read", expires: now + 300000, observedAt: new Date(now).toISOString(), observations: [{ toolName: "query_tickets", failed: false, resultHash: "a".repeat(64) }] };
 const available = new Set(["query_tickets", "get_work_hub_briefing"]);
 return { task, input, receipt, available };
}
it("saves observed reads only and unlocks exact dependencies with server proof", () => {
 const { task, input, receipt, available } = setup();
 const output = preparePlanCompletion([task], input, identity, owner, available, available, { receipt }, secret, now);
 const saved = { ...task, version: 4, description: output.payload.description };
 expect(JSON.parse(saved.description).steps[0].detail).toContain("no business action asserted");
 expect(resumedWorkPlan([saved], saved.id, identity, available, now, (id, plan) => verifiedPlanCompletionIds(secret, id, plan)).eligibleStepIds).toEqual(["next"]);
 expect(resumedWorkPlan([saved], saved.id, identity, available, now).eligibleStepIds).toEqual([]);
});
it("revalidation refuses expiry, revocation, failed reads, changed task or actor and model assertions", () => {
 const { task, input, receipt, available } = setup();
 for (const change of [{ expires: now }, { userId: 18 }, { taskVersion: 2 }, { observations: [{ ...receipt.observations[0], failed: true }] }])
  expect(() => preparePlanCompletion([task], input, identity, owner, available, available, { receipt: { ...receipt, ...change } }, secret, now)).toThrow();
 expect(() => preparePlanCompletion([{ ...task, version: 4 }], input, identity, owner, available, available, { receipt }, secret, now)).toThrow("version");
 expect(() => preparePlanCompletion([task], input, identity, owner, new Set(), new Set(), { receipt }, secret, now)).toThrow("eligible");
 expect(() => preparePlanCompletion([task], { ...input, completed: true }, identity, owner, available, available, { receipt }, secret, now)).toThrow();
});
it("forged completed task text cannot release a dependent checkpoint", () => {
 const { task, available } = setup();
 const plan = JSON.parse(task.description); plan.steps[0].state = "completed"; plan.steps[0].resultReferences = ["ticket:42"];
 expect(resumedWorkPlan([{ ...task, description: JSON.stringify(plan) }], task.id, identity, available, now, (id, saved) => verifiedPlanCompletionIds(secret, id, saved)).eligibleStepIds).toEqual([]);
});
it("saves exact created WorkHub task proof and refuses a missing task read scope", () => {
 const { task, available } = setup();
 const recordId = "33333333-3333-4333-8333-333333333333";
 const plan = createCoordinatedPlan(identity, [{ id: "create", specialist: "V", toolNames: ["manage_work_hub_task"], dependsOn: [], completion: { kind: "canonical_work_hub_task_action_saved", action: "create", title: "Follow up" } }]);
 const resource = { id: recordId, ownerOrgType: "vendor", ownerOrgId: 4, title: "Follow up", version: 1, status: "open" };
 const action = { state: "completed", toolName: "manage_work_hub_task", executionFingerprint: "saved-operation", arguments: { action: "create", owner, expectedVersion: null, payload: { title: "Follow up" } }, result: JSON.stringify({ operationId: "44444444-4444-4444-8444-444444444444", appliedAt: new Date(now).toISOString(), resource }) };
 const tasks = [{ ...task, description: encodePlanDescription(plan) }], request = { taskId: task.id, expectedTaskVersion: 3, stepId: "create", actionReference: "17.existing-action" }, tools = new Set([...available, "manage_work_hub_task", "list_work_hub_tasks"]), evidence = { action, resource: { ...resource, subjectType: "task" } };
 const output = preparePlanCompletion(tasks, request, identity, owner, tools, new Set(["list_work_hub_tasks"]), evidence, secret, now);
 expect(JSON.parse(output.payload.description).steps[0]).toMatchObject({ state: "completed", detail: expect.stringContaining("not physical-work proof") });
 expect(() => preparePlanCompletion(tasks, request, identity, owner, tools, new Set(), evidence, secret, now)).toThrow("read permission");
});
