import { expect, it, vi } from "vitest";
import { gateTaskActionType, gateTaskExecutionGuard, transitionGateTask, reconcileGateTaskOutcome, type GateTaskState } from "./gate-task-state";
const draft = transitionGateTask(null, { expectedVersion: 0, action: "start", taskType: "check_in", fields: { firstName: "Test", lastName: "Worker", vehiclePlate: "TEST123", plateState: "TX", siteLocationId: 4 } });
it("corrects one field without losing the person, vehicle or selected site", () => {
  const next = transitionGateTask(draft, { expectedVersion: 1, action: "correct", fields: { plateState: "OK" } });
  expect(next).toMatchObject({ version: 2, fields: { ...draft.fields, plateState: "OK" } });
  expect(() => gateTaskExecutionGuard(next, "confirm_visitor_check_in", draft.fields)).toThrow("plateState");
  expect(gateTaskExecutionGuard(next, "confirm_visitor_check_in", next.fields)).toBeNull();
});
it("normalizes a spoken state correction without losing other fields", () => {
  expect(transitionGateTask(draft, { expectedVersion: 1, action: "correct", fields: { plateState: "Oklahoma" } }).fields).toEqual({ ...draft.fields, plateState: "OK" });
});
it("recovers an interrupted visit readback from the saved receipt without a write", async () => {
  const savedReceipt = { id: 42, firstName: "Test", lastName: "Worker", siteLocationId: 4, checkInTime: "2026-11-11T10:00:00Z", checkOutTime: null };
  const task: GateTaskState = { ...draft, state: "outcome_unknown", execution: { toolName: "confirm_visitor_check_in", result: JSON.stringify({ ok: false, status: "outcome_unknown", savedReceipt }) } };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => savedReceipt });
  vi.stubGlobal("fetch", fetch);
  try {
    expect(await reconcileGateTaskOutcome(task, { userId: 1, role: "vendor", vendorId: 2 })).toMatchObject({ ok: true, visitId: 42, verification: "canonical_readback" });
    expect(fetch.mock.calls.map(call => call[1].method)).toEqual(["GET"]);
    fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "Access revoked" }) });
    expect(await reconcileGateTaskOutcome(task, { userId: 1, role: "vendor", vendorId: 2 })).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});
it("restores serializable state and rejects concurrent stale corrections", () => {
  const restored = JSON.parse(JSON.stringify(draft));
  expect(() => transitionGateTask(restored, { expectedVersion: 0, action: "correct", fields: { company: "Other" } })).toThrow("changed");
  expect(transitionGateTask(restored, { expectedVersion: 1, action: "correct", fields: { company: "Fixture" } }).fields.firstName).toBe("Test");
});
it("keeps actor, company and conversation storage identities separate", () => {
  const key = gateTaskActionType(1, "vendor:2", 3);
  expect(new Set([key, gateTaskActionType(2, "vendor:2", 3), gateTaskActionType(1, "vendor:4", 3), gateTaskActionType(1, "vendor:2", 4)]).size).toBe(4);
});
it("does not silently retarget, replace or execute a cancelled draft", () => {
  expect(() => transitionGateTask(draft, { expectedVersion: 1, action: "start", taskType: "check_out" })).toThrow();
  expect(() => gateTaskExecutionGuard(draft, "confirm_visitor_check_in", { ...draft.fields, siteLocationId: 5 })).toThrow("siteLocationId");
  const cancelled = transitionGateTask(draft, { expectedVersion: 1, action: "cancel" });
  expect(() => gateTaskExecutionGuard(cancelled, "confirm_visitor_check_in", draft.fields)).toThrow("cancelled");
});
it.each(["saved", "outcome_unknown"] as const)("replays %s result instead of authorizing another write", state => {
  const result = JSON.stringify({ ok: state === "saved", status: state, visitId: 42 });
  const task: GateTaskState = { ...draft, state, execution: { toolName: "confirm_visitor_check_in", result } };
  expect(gateTaskExecutionGuard(task, "confirm_visitor_check_in", draft.fields)).toBe(result);
  if (state === "outcome_unknown") {
    expect(() => transitionGateTask(task, { expectedVersion: 1, action: "start", taskType: "check_in" })).toThrow();
    expect(() => transitionGateTask(task, { expectedVersion: 1, action: "cancel" })).toThrow();
  }
});
it("rejects fabricated actor fields and preserves explicit field clearing", () => {
  expect(() => transitionGateTask(draft, { expectedVersion: 1, action: "correct", fields: { userId: 99 } })).toThrow();
  const cleared = transitionGateTask(draft, { expectedVersion: 1, action: "correct", fields: { plateState: null } });
  expect(cleared.fields.plateState).toBeNull();
  expect(() => gateTaskExecutionGuard(cleared, "confirm_visitor_check_in", draft.fields)).toThrow();
});
