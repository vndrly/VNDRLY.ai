import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  makeWorkHubShiftOpeningAttempt,
  submitWorkHubShiftOpeningAttempt,
} from "./work-hub-shift-opening-client";
const attempt = makeWorkHubShiftOpeningAttempt(
  {
    actorUserId: 1072,
    shiftId: "22222222-2222-4222-8222-222222222222",
    owner: { type: "vendor", id: 1107 },
    context: { kind: "gate", id: 392 },
    input: {
      operationId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 2,
      open: true,
    },
  },
  (x) => createHash("sha256").update(x).digest("hex"),
);
const receipt = {
  operationId: attempt.input.operationId,
  actorUserId: 1072,
  ownerOrgType: "vendor",
  ownerOrgId: 1107,
  shiftId: attempt.shiftId,
  previousVersion: 2,
  resultingVersion: 3,
  open: true,
  commandFingerprint: attempt.commandFingerprint,
  recordedAt: "2026-10-07T12:00:00.000Z",
  physicalAttendanceVerified: false,
};
describe("immutable claim window recovery", () => {
  it("recovers dropped saved response without another PATCH", async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce({ receipt: null })
      .mockRejectedValueOnce(Error("lost"))
      .mockResolvedValueOnce({ receipt });
    await expect(
      submitWorkHubShiftOpeningAttempt(attempt, http, (x) =>
        createHash("sha256").update(x).digest("hex"),
      ),
    ).rejects.toThrow("lost");
    expect(
      await submitWorkHubShiftOpeningAttempt(attempt, http, (x) =>
        createHash("sha256").update(x).digest("hex"),
      ),
    ).toEqual(receipt);
    expect(http.mock.calls.filter((c) => c[1] === "PATCH")).toHaveLength(1);
    expect(http.mock.calls[1][2]).toMatchObject({
      operationId: attempt.input.operationId,
      expectedVersion: 2,
      payload: { action: "update", open: true },
    });
  });
  it("refuses denied or substituted readback without resending", async () => {
    for (const response of [
      { ...receipt, open: false },
      { ...receipt, ownerOrgId: 1108 },
      { ...receipt, actorUserId: 1073 },
      { ...receipt, resultingVersion: 5 },
    ]) {
      const http = vi.fn().mockResolvedValue({ receipt: response });
      await expect(
        submitWorkHubShiftOpeningAttempt(attempt, http, (x) =>
          createHash("sha256").update(x).digest("hex"),
        ),
      ).rejects.toThrow();
      expect(http).toHaveBeenCalledTimes(1);
    }
    const deny = vi.fn().mockRejectedValue(Error("403"));
    await expect(
      submitWorkHubShiftOpeningAttempt(attempt, deny, (x) =>
        createHash("sha256").update(x).digest("hex"),
      ),
    ).rejects.toThrow();
    expect(deny).toHaveBeenCalledTimes(1);
  });
});

it("rejects corrupted persisted command before any read or effect", async () => {
  const http = vi.fn();
  for (const changed of [
    { ...attempt, input: { ...attempt.input, open: false } },
    { ...attempt, input: { ...attempt.input, extra: true } },
    { ...attempt, owner: { type: "vendor", id: 1108 } },
    { ...attempt, unexpected: true },
  ]) {
    await expect(
      submitWorkHubShiftOpeningAttempt(changed as typeof attempt, http, (x) =>
        createHash("sha256").update(x).digest("hex"),
      ),
    ).rejects.toThrow();
  }
  expect(http).not.toHaveBeenCalled();
});
