import { expect, it, vi } from "vitest";
import { recoverOperationsDisplayAction } from "./operations-display-action-recovery";

const session = { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin" };
const action = { toolName: "confirm_operations_displays_action", tokenHash: "a".repeat(64), arguments: {
  action: "route", displayId: "00000000-0000-4000-8000-000000000001", expectedUpdatedAt: "2026-10-07T10:00:00.123Z",
  reason: "Show authorized site", monitorName: "Left", view: "gate_log", siteLocationId: 392,
} };
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const receipt = { operationId, displayId: action.arguments.displayId, action: "route", actorUserId: 17,
  fingerprint: "b".repeat(64), status: "applied", recordedAt: "2026-10-07T10:00:01.000Z",
  physicalDisplayVerified: false, cameraStarted: false, microphoneStarted: false };

it("recovers only through exact readback with the approval-owned UUID and original CAS payload", async () => {
  const request = vi.fn(async () => receipt);
  expect(await recoverOperationsDisplayAction({ ...action, arguments: { ...action.arguments, operationId: "model-key" } }, session, ["operations:write"], request)).toEqual(receipt);
  expect(request).toHaveBeenCalledExactlyOnceWith("/implementation-a/operations-displays/commands/readback", "POST", { ...action.arguments, operationId }, session);
});

it("never reads for removed scope, downgraded role, other tool or invalid action identity", async () => {
  const request = vi.fn(async () => receipt);
  for (const [candidate, actor, scopes] of [
    [action, session, ["operations:read"]],
    [action, { ...session, membershipRole: "member" }, ["operations:write"]],
    [{ ...action, toolName: "manage_work_hub_task" }, session, ["operations:write"]],
    [{ ...action, tokenHash: "invalid" }, session, ["operations:write"]],
  ] as const) expect(await recoverOperationsDisplayAction(candidate, actor, [...scopes], request)).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("keeps absent, denied, malformed or mismatched receipts unknown without retrying execution", async () => {
  for (const result of [{ error: "operations_display.operation_not_found" }, { ok: false }, {},
    { ...receipt, actorUserId: 18 }, { ...receipt, operationId: action.arguments.displayId },
    { ...receipt, action: "revoke" }, { ...receipt, physicalDisplayVerified: true }, { ...receipt, privateToken: "secret" }]) {
    const request = vi.fn(async () => result);
    expect(await recoverOperationsDisplayAction(action, session, ["operations:write"], request)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  }
  const denied = vi.fn(async () => { throw Error("Current Gate contract revoked"); });
  expect(await recoverOperationsDisplayAction(action, session, ["operations:write"], denied)).toBeNull();
  expect(denied).toHaveBeenCalledTimes(1);
});
