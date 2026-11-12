import { beforeEach, expect, it, vi } from "vitest";
import { executeGateMovement, gateMovementOperationId, gateMovementRequest, projectGateMovements, verifyGateMovement } from "./gate-movement-tools";
import { bindWorkHubToolScope, resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { toolsForRealtime } from "./tool-packs";
const fetchMock = vi.fn();
const actor = { userId: 8, role: "vendor", vendorId: 7, vendorRole: "gatekeeper" };
const command = { siteId: 5, visitId: 1, gateId: "11111111-1111-4111-8111-111111111111", kind: "enter" as const };
const approved = { ...command, confirmed: true, idempotencyKey: "server-bound-key" };
const operationId = gateMovementOperationId(approved.idempotencyKey);
const movement = { ...command, operationId, destinationGateId: null, destination: "remain", actorId: 8 };
const snapshot = { gates: [], visits: [{ id: 1, movements: [movement], presence: { currentGateId: command.gateId }, checkOutTime: null }] };
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
it("installs movement actions in both native and web Gate packs", () => {
  for (const path of ["/gate", "/mobile/gate"]) for (const name of ["query_gate_visit_movements", "confirm_gate_visit_movement"])
    expect(toolsForRealtime({ role: "vendor", path }).map(t => t.name)).toContain(name);
});
it("requires server approval and rejects model scope, identity and unsupported departure overrides", () => {
  expect(resolveExecutableWorkHubToolRequest("confirm_gate_visit_movement", command, false, actor)).toMatchObject({ requiresConfirmation: true });
  expect(resolveExecutableWorkHubToolRequest("confirm_gate_visit_movement", approved, true, actor)).toMatchObject({ method: "POST", body: { ...command, operationId } });
  for (const extra of [{ companyId: 99 }, { actorId: 99 }, { operationId: crypto.randomUUID() }, { kind: "site_exit" }, { gateId: "../foreign" }, { destination: "site_exit" }])
    expect(resolveExecutableWorkHubToolRequest("confirm_gate_visit_movement", { ...approved, ...extra }, true, actor)).toHaveProperty("error");
  expect(resolveExecutableWorkHubToolRequest("confirm_gate_visit_movement", approved, true, { userId: 9, role: "anonymous" })).toHaveProperty("error");
});
it("keeps read scope exact and filters a resumed visit", () => {
  const input = { siteId: 5, visitId: 1 };
  expect(bindWorkHubToolScope(input, actor, "query_gate_visit_movements")).toEqual(input);
  expect(gateMovementRequest("query_gate_visit_movements", input)).toMatchObject({ method: "GET", path: "/gate-change-over/movements?siteId=5" });
  expect(projectGateMovements(input, { ...snapshot, visits: [...snapshot.visits, { id: 2 }] })).toMatchObject({ visits: snapshot.visits });
});
it("only reports saved after exact canonical readback", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ movement }) }).mockResolvedValueOnce({ ok: true, json: async () => snapshot });
  expect(await executeGateMovement(approved, actor)).toMatchObject({ ok: true, operationId, visitId: 1, verification: "canonical_readback" });
  expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["POST", "GET"]);
});
it("reconciles a lost save response without issuing a second write", async () => {
  fetchMock.mockRejectedValueOnce(Error("connection lost after commit")).mockResolvedValueOnce({ ok: true, json: async () => snapshot });
  expect(await executeGateMovement(approved, actor)).toMatchObject({ ok: true, operationId });
  expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["POST", "GET"]);
});
it("retains uncertainty when save and readback cannot be verified", async () => {
  fetchMock.mockRejectedValue(Error("offline"));
  expect(await executeGateMovement(approved, actor)).toMatchObject({ ok: false, status: "outcome_unknown", operationId });
  expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["POST", "GET"]);
});
it.each([403, 404, 409])("preserves canonical access, inactive-gate and concurrency rejection %i", async status => {
  fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ message: "Rejected by Gate", code: "gate_topology.rejected" }) });
  expect(await executeGateMovement(approved, actor)).toMatchObject({ ok: false, status, error: "Rejected by Gate" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not substitute another visit, operation or gate as proof", () => {
  for (const value of [null, {}, { ...snapshot, visits: [{ ...snapshot.visits[0], id: 2 }] },
    { ...snapshot, visits: [{ id: 1, movements: [{ ...movement, operationId: "other" }] }] },
    { ...snapshot, visits: [{ id: 1, movements: [{ ...movement, gateId: "other" }] }] }])
    expect(verifyGateMovement(command, operationId, value)).toMatchObject({ ok: false, status: "outcome_unknown" });
});
it("keeps replay identity stable and different approved actions separate", () => {
  expect(gateMovementOperationId("same")).toBe(gateMovementOperationId("same"));
  expect(gateMovementOperationId("other")).not.toBe(gateMovementOperationId("same"));
});
