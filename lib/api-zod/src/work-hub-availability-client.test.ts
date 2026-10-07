import { describe, expect, it, vi } from "vitest";
import { WorkHubAvailabilityInputSchema } from "./work-hub-availability";
import {
  submitWorkHubAvailabilityAttempt,
  type WorkHubAvailabilityAttempt,
} from "./work-hub-availability-client";
const body = {
  operationId: "11111111-1111-4111-8111-111111111111",
  recordId: null,
  expectedFingerprint: "a".repeat(64),
  window: {
    plannedStartAt: "2026-10-10T10:00:00Z",
    plannedEndAt: "2026-10-10T11:00:00Z",
    timezone: "UTC",
  },
  available: true,
};
const attempt: WorkHubAvailabilityAttempt = {
  userId: 2,
  companyId: 7,
  actorMembershipId: 12,
  actorSessionVersion: 3,
  body,
  commandFingerprint: "b".repeat(64),
};
const saved = {
  operationId: body.operationId,
  actorUserId: 2,
  userId: 2,
  companyId: 7,
  actorMembershipId: 12,
  actorSessionVersion: 3,
  commandFingerprint: attempt.commandFingerprint,
  previousFingerprint: body.expectedFingerprint,
  resultingFingerprint: "c".repeat(64),
  record: {
    id: "22222222-2222-4222-8222-222222222222",
    startsAt: new Date(body.window.plannedStartAt).toISOString(),
    endsAt: new Date(body.window.plannedEndAt).toISOString(),
    available: true,
    recurring: false,
  },
  recordedAt: "2026-10-07T22:00:00Z",
  physicalReadinessVerified: false,
};
const snapshot = {
  userId: 2,
  companyId: 7,
  actorMembershipId: 12,
  actorSessionVersion: 3,
  fingerprint: body.expectedFingerprint,
  records: [],
  canManage: true,
  physicalReadinessVerified: false,
};
describe("own availability immutable client", () => {
  it("lost POST then denied read retains exact body; eventual exact GET recovers without another POST", async () => {
    let phase = 0;
    const request = vi.fn(async (method: string) => {
      if (phase === 0) {
        if (method === "POST") throw Error("response lost");
        return request.mock.calls.length === 1 ? { receipt: null } : snapshot;
      }
      if (phase === 1) throw Error("403");
      return { receipt: saved };
    });
    const deps = { request, assertCurrent: () => {} };
    await expect(
      submitWorkHubAvailabilityAttempt(attempt, deps),
    ).rejects.toThrow("response lost");
    phase = 1;
    await expect(
      submitWorkHubAvailabilityAttempt(attempt, deps),
    ).rejects.toThrow("403");
    phase = 2;
    expect(await submitWorkHubAvailabilityAttempt(attempt, deps)).toEqual(
      saved,
    );
    expect(
      request.mock.calls.filter(([method]) => method === "POST"),
    ).toHaveLength(1);
    expect(request.mock.calls[2][2]).toEqual(body);
  });
  it("refuses wrong actor/context/command receipts and stale snapshot before POST", async () => {
    for (const mutation of [
      { userId: 9 },
      { companyId: 8 },
      { actorMembershipId: 13 },
      { actorSessionVersion: 4 },
      { commandFingerprint: "d".repeat(64) },
      { record: { ...saved.record, available: false } },
    ]) {
      const request = vi.fn(async () => ({
        receipt: { ...saved, ...mutation },
      }));
      await expect(
        submitWorkHubAvailabilityAttempt(attempt, {
          request,
          assertCurrent: () => {},
        }),
      ).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
    }
    const request = vi.fn(async () =>
      request.mock.calls.length === 1
        ? { receipt: null }
        : { ...snapshot, fingerprint: "d".repeat(64) },
    );
    await expect(
      submitWorkHubAvailabilityAttempt(attempt, {
        request,
        assertCurrent: () => {},
      }),
    ).rejects.toThrow("availability_changed");
    expect(request.mock.calls.every(([m]) => m === "GET")).toBe(true);
  });
  it("rejects other-user targets and unbounded windows without changing Fleet schemas", () => {
    expect(
      WorkHubAvailabilityInputSchema.safeParse({ ...body, userId: 9 }).success,
    ).toBe(false);
    expect(
      WorkHubAvailabilityInputSchema.safeParse({
        ...body,
        window: { ...body.window, plannedEndAt: "2027-01-01T10:00:00Z" },
      }).success,
    ).toBe(false);
  });
});
