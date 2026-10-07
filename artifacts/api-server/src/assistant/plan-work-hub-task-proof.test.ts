import { expect, it } from "vitest";
import { verifySavedWorkHubTaskCompletion } from "./plan-work-hub-task-proof";
const id = "11111111-1111-4111-8111-111111111111", operationId = "22222222-2222-4222-8222-222222222222";
const identity = { userId: 17, organizationKey: "vendor:4" };
const resource = { id, ownerOrgType: "vendor", ownerOrgId: 4, version: 8, title: "Inspect pump", status: "completed", assigneeUserId: 17 };
const step = { id: "finish", specialist: "V", toolNames: ["manage_work_hub_task"], dependsOn: [], completion: { kind: "canonical_work_hub_task_action_saved" as const, action: "complete" as const, taskId: id } };
const action = { state: "completed", toolName: "manage_work_hub_task", arguments: { action: "complete", taskId: id, expectedVersion: 7, owner: { type: "vendor", id: 4 }, payload: {} }, executionFingerprint: "saved-canonical-operation", result: JSON.stringify({ operationId, appliedAt: "2030-01-01T12:00:00Z", replayed: false, resource }) };
it("recognizes exact saved task completion and its current same-version canonical read", () => {
 expect(verifySavedWorkHubTaskCompletion(step, action, { ...resource, subjectType: "task" }, identity)).toMatchObject({ resourceId: id, operationId });
});
it("refuses pending, stale CAS, foreign owner, wrong resource, failed operation and changed canonical outcome", () => {
 for (const value of [{ ...action, state: "pending" }, { ...action, arguments: { ...action.arguments, expectedVersion: 6 } }, { ...action, arguments: { ...action.arguments, owner: { type: "vendor", id: 5 } } }, { ...action, result: JSON.stringify({ error: "Denied" }) }, { ...action, result: JSON.stringify({ operationId, appliedAt: "2030-01-01T12:00:00Z", resource: { ...resource, id: "33333333-3333-4333-8333-333333333333" } }) }])
  expect(() => verifySavedWorkHubTaskCompletion(step, value, { ...resource, subjectType: "task" }, identity)).toThrow();
 for (const current of [{ ...resource, version: 9 }, { ...resource, status: "open" }, { ...resource, ownerOrgId: 5 }])
  expect(() => verifySavedWorkHubTaskCompletion(step, action, { ...current, subjectType: "task" }, identity)).toThrow();
});
it("recognizes created task ID only from saved command receipt, with exact requested title and assignee", () => {
 const created = { ...resource, version: 1, status: "open" };
 const createStep = { ...step, completion: { kind: "canonical_work_hub_task_action_saved" as const, action: "create" as const, title: "Inspect pump", assigneeUserId: 17 } };
 const createAction = { ...action, arguments: { action: "create", expectedVersion: null, owner: { type: "vendor", id: 4 }, payload: { title: "Inspect pump", assigneeUserId: 17 } }, result: JSON.stringify({ operationId, appliedAt: "2030-01-01T12:00:00Z", replayed: false, resource: created }) };
 expect(verifySavedWorkHubTaskCompletion(createStep, createAction, { ...created, subjectType: "task" }, identity).resourceId).toBe(id);
 expect(verifySavedWorkHubTaskCompletion(createStep, { ...createAction, arguments: { ...createAction.arguments, expectedVersion: undefined } }, { ...created, subjectType: "task" }, identity).resourceId).toBe(id);
 expect(() => verifySavedWorkHubTaskCompletion(createStep, { ...createAction, arguments: { ...createAction.arguments, payload: { title: "Other task", assigneeUserId: 17 } } }, { ...created, subjectType: "task" }, identity)).toThrow();
 expect(() => verifySavedWorkHubTaskCompletion(createStep, createAction, { ...created, title: "Other task", subjectType: "task" }, identity)).toThrow();
});
