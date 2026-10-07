import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { gateShiftAssignmentFingerprintValues } from "@workspace/api-zod";
const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("./chatgpt-tool-access", () => ({ chatGptActionTools: () => access.allowed ? [{ name: "manage_work_hub_shift" }] : [] }));
import { recoverGateShiftClaimAction } from "./gate-shift-claim-recovery";
const shiftId = "00000000-0000-4000-8000-000000000001";
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const session = { userId: 9, role: "field_employee", vendorId: 4, sv: 1 };
const action = { toolName: "manage_work_hub_shift", tokenHash: "a".repeat(64), arguments: { action: "claim", shiftId, expectedVersion: 2, payload: {} } };
const receipt = {
  operationId, actorUserId: 9, shiftId, previousVersion: 2, resultingVersion: 3, assigneeUserIds: [9],
  commandFingerprint: createHash("sha256").update(JSON.stringify({ action: "claim", ...gateShiftAssignmentFingerprintValues(shiftId, 9, 4, { operationId, expectedVersion: 2, assigneeUserIds: [9] }) })).digest("hex"),
  recordedAt: "2026-10-07T10:00:00.000Z", assignmentRecorded: true, physicalAttendanceVerified: false,
};
beforeEach(() => { access.allowed = true; });
it("reads only the exact actor-bound approved claim operation and never sends", async () => {
  const request = vi.fn(async () => ({ receipt }));
  expect(await recoverGateShiftClaimAction(action, session, ["work_hub:write"], request)).toEqual(receipt);
  expect(request).toHaveBeenCalledExactlyOnceWith(`/work-hub/shifts/${shiftId}/claim/operations/${operationId}`, "GET", {}, session);
});
it("leaves missing, changed-version, wrong actor or fingerprint outcomes unverified", async () => {
  for (const saved of [null, { ...receipt, actorUserId: 10 }, { ...receipt, previousVersion: 1 }, { ...receipt, resultingVersion: 4 }, { ...receipt, commandFingerprint: "b".repeat(64) }]) {
    expect(await recoverGateShiftClaimAction(action, session, [], vi.fn(async () => ({ receipt: saved })))).toBeNull();
  }
});
it("rejects missing current tool, caller operation overrides and foreign owner before requesting", async () => {
  const request = vi.fn();
  for (const arguments_ of [{ ...action.arguments, operationId }, { ...action.arguments, owner: { type: "vendor", id: 99 } }]) {
    expect(await recoverGateShiftClaimAction({ ...action, arguments: arguments_ }, session, [], request)).toBeNull();
  }
  access.allowed = false;
  expect(await recoverGateShiftClaimAction(action, session, [], request)).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
