import { expect, it } from "vitest";
import { createCoordinatedPlan } from "./coordinated-plan";
import { prepareBoundExecutionProposal } from "./plan-execution-approval";
import { PLAN_OPERATION_INPUTS } from "./plan-operation-inputs";
import { assembleBackgroundFragments, prepareBackgroundFragment } from "./background-plan-fragments";
const secret = "independent-fragment-contract-secret-only";
function fixture() {
  const plan = createCoordinatedPlan({ userId: 17, organizationKey: "vendor:4" }, [
    { id: "read", specialist: "Ivy", toolNames: ["query_asset_custody"], dependsOn: [] },
    { id: "draft", specialist: "V", toolNames: ["manage_work_hub_task"], dependsOn: ["read"], completion: { kind: "canonical_work_hub_task_action_saved", action: "create", title: "Custody review", assigneeUserId: 17 } },
  ]);
  const context = { requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 }, grantReference: "private-bound-grant", taskId: "00000000-0000-4000-8000-000000000010", taskVersion: 3, availableTools: new Set(["query_asset_custody", "manage_work_hub_task"]) };
  const base = { taskId: context.taskId, expectedTaskVersion: 3, expectedPlanVersion: plan.version };
  const prepare = (id: "read" | "draft", extra = {}) => {
    const op = PLAN_OPERATION_INPUTS.find(o => o.toolName === (id === "read" ? "query_asset_custody" : "manage_work_hub_task"))!;
    return prepareBackgroundFragment("v_plan_step__" + op.key, { ...base, id, arguments: id === "read" ? {} : { title: "Custody review" }, ...extra }, plan, context, secret, 1000);
  };
  const input = { ...base, expiresInMinutes: 30, maxAttempts: 2, fragmentReferences: [prepare("read").fragmentReference, prepare("draft").fragmentReference] };
  return { plan, context, base, prepare, input };
}
it("assembles the full saved dependency graph without starting work or accepting model operation IDs", () => {
  const f = fixture(), fragment = f.prepare("draft");
  expect(fragment).toMatchObject({ executionStarted: false, approvalGranted: false, expiresAt: 301000 });
  expect(fragment.step).not.toHaveProperty("operationId");
  expect(JSON.stringify(fragment)).not.toContain(f.context.grantReference);
  const run = assembleBackgroundFragments(f.input, f.plan, f.context, secret, 2000);
  expect(run.steps[1].dependsOn).toEqual(["read"]);
  expect(run.requester).toEqual(f.context.requester);
  expect(run.grantReference).toBe(f.context.grantReference);
  expect(new Set(run.steps.map(s => s.operationId)).size).toBe(2);
  for (const extra of [{ operationId: run.steps[0].operationId }, { toolName: "manage_work_hub_task" }, { adapter: "personal_draft" }, { dependsOn: [] }, { requester: f.context.requester }]) expect(() => f.prepare("read", extra)).toThrow();
});
it("rejects tampering, wrong signing domain secret, expiry, future issuance and duplicated fragments", () => {
  const f = fixture(), [body, signature] = f.input.fragmentReferences[0].split(".");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  claims.step.arguments = { assetId: "00000000-0000-4000-8000-000000000011" };
  const changed = Buffer.from(JSON.stringify(claims)).toString("base64url") + "." + signature;
  for (const refs of [[changed, f.input.fragmentReferences[1]], [f.input.fragmentReferences[0] + ".extra"], [f.input.fragmentReferences[0], f.input.fragmentReferences[0]]]) expect(() => assembleBackgroundFragments({ ...f.input, fragmentReferences: refs }, f.plan, f.context, secret, 2000)).toThrow();
  expect(() => assembleBackgroundFragments(f.input, f.plan, f.context, secret + "other", 2000)).toThrow("signature");
  for (const now of [999, 301000]) expect(() => assembleBackgroundFragments(f.input, f.plan, f.context, secret, now)).toThrow("authority");
});
it("refuses changed actor, company, membership, session, grant, task, plan or current tool availability", () => {
  const f = fixture();
  for (const requester of [{ ...f.context.requester, userId: 18 }, { ...f.context.requester, organizationKey: "vendor:5" }, { ...f.context.requester, membershipId: 13 }, { ...f.context.requester, sessionVersion: 2 }]) expect(() => assembleBackgroundFragments(f.input, f.plan, { ...f.context, requester }, secret, 2000)).toThrow();
  for (const context of [{ ...f.context, grantReference: "changed" }, { ...f.context, grantReference: "" }, { ...f.context, taskVersion: 4 }, { ...f.context, availableTools: new Set<string>() }]) expect(() => assembleBackgroundFragments(f.input, f.plan, context, secret, 2000)).toThrow();
  for (const plan of [{ ...f.plan, id: "00000000-0000-4000-8000-000000000012" }, { ...f.plan, version: 2 }, { ...f.plan, steps: f.plan.steps.map(s => ({ ...s, specialist: "Changed" })) }]) expect(() => assembleBackgroundFragments(f.input, plan, f.context, secret, 2000)).toThrow();
});
it("retains whole-plan prerequisites and strict reference-only coordinator inputs with legacy internal compatibility", () => {
  const f = fixture();
  expect(() => assembleBackgroundFragments({ ...f.input, fragmentReferences: [f.input.fragmentReferences[1]] }, f.plan, f.context, secret, 2000)).toThrow("prerequisite");
  for (const extra of [{ steps: [f.prepare("read").step] }, { dependsOn: [] }, { operationId: "model" }, { requester: f.context.requester }]) expect(() => assembleBackgroundFragments({ ...f.input, ...extra }, f.plan, f.context, secret, 2000)).toThrow();
  const legacy = prepareBoundExecutionProposal(f.plan, f.context, { ...f.base, expiresInMinutes: 30, maxAttempts: 2, steps: [f.prepare("read").step, f.prepare("draft").step] }, 2000);
  expect(legacy.steps[1].dependsOn).toEqual(["read"]);
  expect(legacy.steps.map(s => s.toolName)).toEqual(["query_asset_custody", "manage_work_hub_task"]);
});