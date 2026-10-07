import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { fleetAvailabilityFingerprintValues } from "@workspace/api-zod";
vi.mock("./natural-voice-write-tools", () => ({
  callNaturalVoiceDomainApi: vi.fn(),
}));
import { recoverFleetAvailabilityAction } from "./fleet-availability-action-recovery";
const session = {
  userId: 1069,
  vendorId: 609,
  role: "vendor",
  membershipRole: "admin",
  activeMembershipId: 9,
  sv: 1,
};
const tokenHash = "a".repeat(64),
  operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const args = {
  driverUserId: 133,
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
  toolName: "record_fleet_driver_availability",
  tokenHash,
  arguments: args,
};
const receipt = {
  operationId,
  actorUserId: 1069,
  companyId: 609,
  driverUserId: 133,
  commandFingerprint: createHash("sha256")
    .update(
      JSON.stringify(
        fleetAvailabilityFingerprintValues(1069, 609, { operationId, ...args }),
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
    await recoverFleetAvailabilityAction(
      action,
      session,
      ["fleet:dispatch"],
      request,
    ),
  ).toEqual({ receipt });
  expect(request.mock.calls).toEqual([
    [
      `/fleet/drivers/133/availability/operations/${operationId}`,
      "GET",
      {},
      session,
    ],
  ]);
});
it("fails closed without current write scope or when model fields substitute authority", async () => {
  const request = vi.fn();
  expect(
    await recoverFleetAvailabilityAction(
      action,
      session,
      ["fleet:read"],
      request,
    ),
  ).toBeNull();
  expect(
    await recoverFleetAvailabilityAction(
      { ...action, arguments: { ...args, companyId: 4 } },
      session,
      ["fleet:dispatch"],
      request,
    ),
  ).toBeNull();
  expect(
    await recoverFleetAvailabilityAction(
      { ...action, arguments: { ...args, operationId } },
      session,
      ["fleet:dispatch"],
      request,
    ),
  ).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it("denied, absent, wrong-owner and false-proof receipts stay unknown without any resend", async () => {
  for (const result of [
    { receipt: null },
    { receipt: { ...receipt, companyId: 4 } },
    { receipt: { ...receipt, driverUserId: 134 } },
    { receipt: { ...receipt, physicalReadinessVerified: true } },
  ]) {
    const request = vi.fn().mockResolvedValue(result);
    expect(
      await recoverFleetAvailabilityAction(
        action,
        session,
        ["fleet:dispatch"],
        request,
      ),
    ).toBeNull();
    expect(request.mock.calls.every((call) => call[1] === "GET")).toBe(true);
  }
  const request = vi.fn().mockRejectedValue(Error("revoked"));
  expect(
    await recoverFleetAvailabilityAction(
      action,
      session,
      ["fleet:dispatch"],
      request,
    ),
  ).toBeNull();
  expect(request).toHaveBeenCalledOnce();
});
