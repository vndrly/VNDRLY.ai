import { createHash } from "node:crypto";
import { it, expect, vi, beforeEach } from "vitest";
import { workHubShiftOpeningFingerprintValues } from "@workspace/api-zod";
const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("./chatgpt-tool-access", () => ({
  chatGptActionTools: () =>
    access.allowed ? [{ name: "manage_work_hub_shift" }] : [],
}));
import { recoverWorkHubShiftOpeningAction } from "./work-hub-shift-opening-recovery";
const session = { userId: 9, role: "vendor", vendorId: 4, sv: 1 },
  id = "22222222-2222-4222-8222-222222222222",
  operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  action = {
    toolName: "manage_work_hub_shift",
    tokenHash: "a".repeat(64),
    arguments: {
      action: "update",
      shiftId: id,
      expectedVersion: 2,
      payload: { open: true },
    },
  };
const receipt = {
  operationId,
  actorUserId: 9,
  ownerOrgType: "vendor",
  ownerOrgId: 4,
  shiftId: id,
  previousVersion: 2,
  resultingVersion: 3,
  open: true,
  commandFingerprint: createHash("sha256")
    .update(
      JSON.stringify(
        workHubShiftOpeningFingerprintValues(id, 9, "vendor", 4, {
          operationId,
          expectedVersion: 2,
          open: true,
        }),
      ),
    )
    .digest("hex"),
  recordedAt: "2026-10-07T10:00:00.000Z",
  physicalAttendanceVerified: false,
};
beforeEach(() => {
  access.allowed = true;
});
it("recovers only exact saved shift opening with GET and no effect", async () => {
  const req = vi.fn(async () => ({ receipt }));
  expect(
    await recoverWorkHubShiftOpeningAction(
      action,
      session,
      ["work_hub:write"],
      req,
    ),
  ).toEqual(receipt);
  expect(req).toHaveBeenCalledExactlyOnceWith(
    `/work-hub/shifts/${id}/open/operations/${operationId}`,
    "GET",
    {},
    session,
  );
});
it("leaves absent, substituted actor/owner/target/version/intent receipts unresolved", async () => {
  for (const saved of [
    null,
    { ...receipt, actorUserId: 10 },
    { ...receipt, ownerOrgId: 5 },
    { ...receipt, shiftId: "33333333-3333-4333-8333-333333333333" },
    { ...receipt, open: false },
    { ...receipt, previousVersion: 1 },
    { ...receipt, commandFingerprint: "b".repeat(64) },
  ])
    expect(
      await recoverWorkHubShiftOpeningAction(
        action,
        session,
        [],
        vi.fn(async () => ({ receipt: saved })),
      ),
    ).toBeNull();
});
it("requires current tool discovery and rejects model operation or mixed edits before GET", async () => {
  const req = vi.fn();
  for (const args of [
    { ...action.arguments, operationId },
    { ...action.arguments, payload: { open: true, title: "other" } },
    { ...action.arguments, owner: { type: "vendor", id: 5 } },
    { ...action.arguments, action: "cancel" },
  ])
    expect(
      await recoverWorkHubShiftOpeningAction(
        { ...action, arguments: args },
        session,
        [],
        req,
      ),
    ).toBeNull();
  access.allowed = false;
  expect(
    await recoverWorkHubShiftOpeningAction(action, session, [], req),
  ).toBeNull();
  expect(req).not.toHaveBeenCalled();
});
