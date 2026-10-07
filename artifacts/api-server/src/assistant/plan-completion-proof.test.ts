import { expect, it } from "vitest";
import { createCoordinatedPlan, checkpointPlan } from "./coordinated-plan";
import { issuePlanCompletionProof, verifiedPlanCompletionIds, verifySavedTicketCompletion } from "./plan-completion-proof";

const identity = { userId: 17, organizationKey: "vendor:4" };
const taskId = "11111111-1111-4111-8111-111111111111";
const secret = "isolated-test-secret";
const plan = () => createCoordinatedPlan(identity, [{ id: "review", specialist: "Finn", toolNames: ["query_tickets"], dependsOn: [], completion: { kind: "planned_read_observed" } }]);
it("only verifies a server signed completion bound to exact task, actor and step intent", () => {
  const base = plan();
  const proof = issuePlanCompletionProof(secret, taskId, base, "review", "a".repeat(64), 1000);
  const saved = checkpointPlan(base, identity, 1, "review", { state: "completed", resultReferences: [proof] });
  expect([...verifiedPlanCompletionIds(secret, taskId, saved)]).toEqual(["review"]);
  for (const changed of [{ ...saved, identity: { ...identity, userId: 18 } }, { ...saved, steps: [{ ...saved.steps[0], toolNames: ["query_ticket_detail"] }] }])
    expect([...verifiedPlanCompletionIds(secret, taskId, changed)]).toEqual([]);
  expect([...verifiedPlanCompletionIds(secret, "22222222-2222-4222-8222-222222222222", saved)]).toEqual([]);
  expect([...verifiedPlanCompletionIds(secret, taskId, { ...saved, steps: [{ ...saved.steps[0], resultReferences: ["ticket:123"] }] })]).toEqual([]);
});
it("checks exact saved action, canonical ticket ID and current outcome; pending or unrelated results refuse", () => {
  const step = { id: "submit", specialist: "Finn", toolNames: ["manage_ticket_record_submit"], dependsOn: [], completion: { kind: "canonical_ticket_action_saved" as const, action: "submit" as const, ticketId: 42 } };
  const action = { state: "completed", toolName: "manage_ticket_record", arguments: { action: "submit", ticketId: 42, payload: {} }, result: JSON.stringify({ id: 42, status: "submitted" }), executionFingerprint: "saved-operation" };
  expect(verifySavedTicketCompletion(step, action, { ticketId: 42, status: "submitted" })).toMatchObject({ ticketId: 42, action: "submit" });
  for (const wrong of [{ ...action, state: "pending" }, { ...action, arguments: { ...action.arguments, ticketId: 43 } }, { ...action, result: JSON.stringify({ error: "denied" }) }, { ...action, executionFingerprint: undefined }])
    expect(() => verifySavedTicketCompletion(step, wrong, { ticketId: 42, status: "submitted" })).toThrow();
  expect(() => verifySavedTicketCompletion(step, action, { ticketId: 42, status: "in_progress" })).toThrow();
});
it("does not verify a copied dependent proof after the prerequisite changes", () => {
  const base = createCoordinatedPlan(identity, [{ ...plan().steps[0] }, { id: "next", specialist: "V", toolNames: ["get_work_hub_briefing"], dependsOn: ["review"], completion: { kind: "planned_read_observed" } }]);
  let saved = checkpointPlan(base, identity, 1, "review", { state: "completed", resultReferences: [issuePlanCompletionProof(secret, taskId, base, "review", "a".repeat(64), 1000)] });
  saved = checkpointPlan(saved, identity, 2, "next", { state: "completed", resultReferences: [issuePlanCompletionProof(secret, taskId, saved, "next", "b".repeat(64), 2000)] });
  expect([...verifiedPlanCompletionIds(secret, taskId, saved)]).toEqual(["review", "next"]);
  saved.steps[0].resultReferences = ["invented"];
  expect([...verifiedPlanCompletionIds(secret, taskId, saved)]).toEqual([]);
});
