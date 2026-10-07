import { expect, it } from "vitest";
import { createCoordinatedPlan, encodePlanDescription } from "./coordinated-plan";
import { preparePlanReadCheckpoint, type PlanReadReceipt } from "./chatgpt-plan-read-checkpoint";

const identity = { userId: 17, organizationKey: "vendor:4" };
const owner = { type: "vendor" as const, id: 4 };
const reads = new Set(["query_tickets", "get_work_hub_calendar"]);
const now = Date.parse("2030-01-01T12:00:00Z");
function setup() {
  const plan = createCoordinatedPlan(identity, [{ id: "review", specialist: "V", toolNames: [...reads], dependsOn: [] }]);
  const task = { id: "11111111-1111-4111-8111-111111111111", ownerOrgType: "vendor", ownerOrgId: 4, version: 3, status: "in_progress", description: encodePlanDescription(plan) };
  const receipt: PlanReadReceipt = { kind: "plan-read-checkpoint", id: "22222222-2222-4222-8222-222222222222", userId: 17, organizationKey: "vendor:4", taskId: task.id, taskVersion: 3, planVersion: 1, stepId: "review", expires: now + 300000, observedAt: new Date(now).toISOString(), observations: [...reads].map(toolName => ({ toolName, failed: false, resultHash: "a".repeat(64) })) };
  return { task, receipt };
}
it("saves observed read references without marking the business step completed", () => {
  const { task, receipt } = setup();
  const result = preparePlanReadCheckpoint([task], receipt, identity, owner, reads, now);
  expect(result).toMatchObject({ expectedVersion: 3, payload: { status: "in_progress" } });
  const plan = JSON.parse(result.payload.description);
  expect(plan.version).toBe(2);
  expect(plan.steps[0].state).toBe("waiting");
  expect(plan.steps[0].resultReferences).toHaveLength(2);
  expect(plan.steps[0].detail).toContain("Business work is not marked completed");
});
it("preserves partial failure rather than pretending the lookup succeeded", () => {
  const { task, receipt } = setup();
  receipt.observations[1].failed = true;
  const result = preparePlanReadCheckpoint([task], receipt, identity, owner, reads, now);
  expect(JSON.parse(result.payload.description).steps[0]).toMatchObject({ state: "failed", detail: expect.stringContaining("1 successful, 1 failed") });
});
it("rejects expired, cross-user, cross-company and forged checkpoint fields", () => {
  const { task, receipt } = setup();
  for (const invalidTime of [Number.NaN, Infinity, -Infinity]) {
    expect(() => preparePlanReadCheckpoint([task], receipt, identity, owner, reads, invalidTime)).toThrow("observation time");
  }
  for (const invalid of [{ ...receipt, expires: now }, { ...receipt, userId: 18 }, { ...receipt, organizationKey: "vendor:5" }, { ...receipt, kind: "component-action" }, { ...receipt, completed: true }]) {
    expect(() => preparePlanReadCheckpoint([task], invalid, identity, owner, reads, now)).toThrow();
  }
});
it("rejects changed task/plan state and newly revoked tools", () => {
  const { task, receipt } = setup();
  expect(() => preparePlanReadCheckpoint([{ ...task, version: 4 }], receipt, identity, owner, reads, now)).toThrow("changed");
  expect(() => preparePlanReadCheckpoint([task], { ...receipt, planVersion: 2 }, identity, owner, reads, now)).toThrow("changed");
  expect(() => preparePlanReadCheckpoint([{ ...task, status: "completed" }], receipt, identity, owner, reads, now)).toThrow("terminal");
  expect(() => preparePlanReadCheckpoint([task], receipt, identity, owner, new Set(["query_tickets"]), now)).toThrow("eligible");
});
it("rejects missing, duplicate or unrelated tool observations", () => {
  const { task, receipt } = setup();
  for (const observations of [receipt.observations.slice(0, 1), [receipt.observations[0], receipt.observations[0]], [...receipt.observations.slice(0, 1), { ...receipt.observations[1], toolName: "manage_ticket_record" }]]) {
    expect(() => preparePlanReadCheckpoint([task], { ...receipt, observations }, identity, owner, reads, now)).toThrow("tools changed");
  }
});
