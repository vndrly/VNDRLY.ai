import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { workHubAvailabilityFingerprintValues } from "@workspace/api-zod";
vi.mock("./natural-voice-write-tools", () => ({
  callNaturalVoiceDomainApi: vi.fn(),
}));
import { recoverWorkHubAvailabilityAction } from "./work-hub-availability-action-recovery";
const session = {
  userId: 1069,
  vendorId: 609,
  role: "field_employee",
  membershipRole: "field_employee",
  activeMembershipId: 9,
  sv: 1,
  vendorPeopleId: 969,
};
const tokenHash = "a".repeat(64),
  operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const args = {

  recordId: null,
  expectedFingerprint: "b".repeat(64),
  window: {
    plannedStartAt: "2026-10-08T18:00:00.000Z",
    plannedEndAt: "2026-10-08T19:00:00.000Z",
    timezone: "UTC",
  },
  available: true,
};
const action = {
  toolName: "manage_work_hub_availability",
  tokenHash,
  arguments: args,
};
const receipt = {
  operationId,
  actorUserId: 1069,
  companyId: 609,

  userId: 1069,
  actorMembershipId: 9,
  actorSessionVersion: 1,
  commandFingerprint: createHash("sha256")
    .update(
      JSON.stringify(
        workHubAvailabilityFingerprintValues(1069, 609, { operationId, ...args }),
      ),
    )
    .digest("hex"),
  previousFingerprint: args.expectedFingerprint,
  resultingFingerprint: "c".repeat(64),
  record: {
    id: "11111111-1111-4111-8111-111111111111",
    startsAt: args.window.plannedStartAt,
    endsAt: args.window.plannedEndAt,
    available: true,
    recurring: false,
  },
  recordedAt: "2026-10-07T18:00:00.000Z",
  physicalReadinessVerified: false,
};
it("reads only the server-bound exact operation and returns an exact authorized receipt", async () => {
  const request = vi.fn().mockResolvedValue({ receipt });
  expect(
    await recoverWorkHubAvailabilityAction(
      action,
      session,
      ["work_hub:write"],
      request,
    ),
  ).toEqual({ receipt });
  expect(request.mock.calls).toEqual([
    [
      `/work-hub/availability/operations/${operationId}`,
      "GET",
      {},
      session,
    ],
  ]);
});
it("fails closed without current write scope or when model fields substitute authority", async () => {
  const request = vi.fn();
  expect(
    await recoverWorkHubAvailabilityAction(
      action,
      session,
      ["work_hub:read"],
      request,
    ),
  ).toBeNull();
  expect(
    await recoverWorkHubAvailabilityAction(
      { ...action, arguments: { ...args, companyId: 4 } },
      session,
      ["work_hub:write"],
      request,
    ),
  ).toBeNull();
  expect(
    await recoverWorkHubAvailabilityAction(
      { ...action, arguments: { ...args, operationId } },
      session,
      ["work_hub:write"],
      request,
    ),
  ).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it("denied, absent, wrong-owner and false-proof receipts stay unknown without any resend", async () => {
  for (const result of [
    { receipt: null },
    { receipt: { ...receipt, companyId: 4 } },
    { receipt: { ...receipt, actorUserId: 12 } },
    { receipt: { ...receipt, operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } },
    { receipt: { ...receipt, record: { ...receipt.record, startsAt: "2026-10-08T17:00:00.000Z" } } },
    { receipt: { ...receipt, record: { ...receipt.record, available: false } } },
    { receipt: { ...receipt, userId: 134 } },
    { receipt: { ...receipt, actorMembershipId: 10 } },
    { receipt: { ...receipt, actorSessionVersion: 2 } },
    { receipt: { ...receipt, commandFingerprint: "d".repeat(64) } },
    { receipt: { ...receipt, physicalReadinessVerified: true } },
  ]) {
    const request = vi.fn().mockResolvedValue(result);
    expect(
      await recoverWorkHubAvailabilityAction(
        action,
        session,
        ["work_hub:write"],
        request,
      ),
    ).toBeNull();
    expect(request.mock.calls.every((call) => call[1] === "GET")).toBe(true);
  }
  const request = vi.fn().mockRejectedValue(Error("revoked"));
  expect(
    await recoverWorkHubAvailabilityAction(
      action,
      session,
      ["work_hub:write"],
      request,
    ),
  ).toBeNull();
  expect(request).toHaveBeenCalledOnce();
});

it("rejects a replacement receipt for a different exact reviewed record", async () => {
  const fields = { ...args, recordId: "22222222-2222-4222-8222-222222222222" };
  const commandFingerprint = createHash("sha256").update(JSON.stringify(workHubAvailabilityFingerprintValues(session.userId, session.vendorId, { operationId, ...fields }))).digest("hex");
  const request = vi.fn().mockResolvedValue({ receipt: { ...receipt, commandFingerprint } });
  expect(await recoverWorkHubAvailabilityAction({ ...action, arguments: fields }, session, ["work_hub:write"], request)).toBeNull();
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][1]).toBe("GET");
});
