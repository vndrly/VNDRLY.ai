import { expect, it } from "vitest";
import { createCoordinatedPlan } from "./coordinated-plan";
import { prepareBoundExecutionProposal } from "./plan-execution-approval";

function fixture() {
  const plan = createCoordinatedPlan({ userId: 17, organizationKey: "vendor:4" }, [
    { id: "read", specialist: "Ivy", toolNames: ["query_asset_custody"], dependsOn: [] },
    { id: "draft", specialist: "V", toolNames: ["manage_work_hub_task"], dependsOn: ["read"],
      completion: { kind: "canonical_work_hub_task_action_saved", action: "create", title: "Custody review", assigneeUserId: 17 } },
  ]);
  const context = { requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 },
    grantReference: "bound-grant", taskId: "00000000-0000-4000-8000-000000000010", taskVersion: 3,
    availableTools: new Set(["query_asset_custody", "manage_work_hub_task"]) };
  const input = { taskId: context.taskId, expectedTaskVersion: 3, expectedPlanVersion: 1, expiresInMinutes: 30, maxAttempts: 2,
    steps: [{ id: "read", adapter: "authorized_read", toolName: "query_asset_custody", arguments: {} },
      { id: "draft", adapter: "personal_draft", toolName: "manage_work_hub_task", arguments: { title: "Custody review" } }] };
  return { plan, context, input };
}

it("derives exact dependencies, identity, expiry and operation IDs from trusted proposal context", () => {
  const f = fixture();
  const result = prepareBoundExecutionProposal(f.plan, f.context, f.input, 1000);
  expect(result.steps[1].dependsOn).toEqual(["read"]);
  expect(result.requester).toEqual(f.context.requester);
  expect(result.expiresAt).toBe(1_801_000);
  expect(new Set([...result.steps.map(step => step.operationId), result.notificationOperationId]).size).toBe(3);
});

it("refuses dropped prerequisites, stale task versions and unavailable tools", () => {
  const f = fixture();
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input, steps: [f.input.steps[1]] })).toThrow("prerequisite");
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input, expectedTaskVersion: 2 })).toThrow("changed");
  expect(() => prepareBoundExecutionProposal(f.plan, { ...f.context, availableTools: new Set() }, f.input)).toThrow("permitted");
});

it("rejects identity injection, unsupported adapters and changed saved draft intent", () => {
  const f = fixture();
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input, requester: { userId: 99 } })).toThrow();
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input, steps: [{ ...f.input.steps[0], adapter: "money_transfer" }] })).toThrow();
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input,
    steps: [f.input.steps[0], { ...f.input.steps[1], arguments: { title: "Different action" } }] })).toThrow("intent");
});
