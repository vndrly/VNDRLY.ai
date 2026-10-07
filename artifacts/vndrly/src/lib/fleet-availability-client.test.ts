import { describe, expect, it, vi } from "vitest";
import {
  FleetAvailabilityAbsentConflict,
  submitFleetAvailabilityAttempt,
  fleetAvailabilityLocalWindow,
} from "@workspace/api-zod";

const body = {
  operationId: "11111111-1111-4111-8111-111111111111",
  driverUserId: 133,
  recordId: null,
  expectedFingerprint: "a".repeat(64),
  window: {
    plannedStartAt: "2026-10-08T18:00:00.000Z",
    plannedEndAt: "2026-10-08T19:00:00.000Z",
    timezone: "America/Chicago",
  },
  available: true,
};
const attempt = {
  actorUserId: 1069,
  companyId: 609,
  body,
  commandFingerprint: "b".repeat(64),
};
const receipt = {
  operationId: body.operationId,
  actorUserId: 1069,
  companyId: 609,
  driverUserId: 133,
  commandFingerprint: attempt.commandFingerprint,
  previousFingerprint: body.expectedFingerprint,
  resultingFingerprint: "c".repeat(64),
  record: {
    id: "22222222-2222-4222-8222-222222222222",
    startsAt: body.window.plannedStartAt,
    endsAt: body.window.plannedEndAt,
    available: true,
    recurring: false,
  },
  recordedAt: "2026-10-07T18:00:00.000Z",
  physicalReadinessVerified: false,
};
const current = {
  driverUserId: 133,
  fingerprint: body.expectedFingerprint,
  records: [],
  canManage: true,
  physicalReadinessVerified: false,
};

describe("Fleet availability exact recovery", () => {
  it("refuses both hour and half-hour DST folds and gaps in the actual device timezone", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/Chicago";
      expect(() => fleetAvailabilityLocalWindow("2026-03-08T02:30", "2026-03-08T04:00")).toThrow();
      expect(() => fleetAvailabilityLocalWindow("2026-11-01T01:30", "2026-11-01T03:00")).toThrow();
      process.env.TZ = "Australia/Lord_Howe";
      expect(() => fleetAvailabilityLocalWindow("2026-04-05T01:45", "2026-04-05T03:00")).toThrow();
      expect(() => fleetAvailabilityLocalWindow("2026-10-04T02:15", "2026-10-04T04:00")).toThrow();
      expect(fleetAvailabilityLocalWindow("2026-10-08T10:00", "2026-10-08T11:00").timezone).toBe("Australia/Lord_Howe");
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it("recovers a dropped response with the original operation without another POST", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ receipt: null })
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new Error("dropped"))
      .mockResolvedValueOnce({ receipt });
    const deps = { request, assertCurrent: vi.fn() };
    await expect(submitFleetAvailabilityAttempt(attempt, deps)).rejects.toThrow(
      "dropped",
    );
    expect(await submitFleetAvailabilityAttempt(attempt, deps)).toEqual(
      receipt,
    );
    expect(request.mock.calls.filter((call) => call[0] === "POST")).toEqual([
      ["POST", "/api/fleet/drivers/133/availability", body],
    ]);
  });
  it("does not resend after denied receipt access", async () => {
    const request = vi.fn().mockRejectedValue(new Error("denied"));
    await expect(
      submitFleetAvailabilityAttempt(attempt, { request, assertCurrent() {} }),
    ).rejects.toThrow("denied");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("refuses known absence with changed evidence or removed management permission", async () => {
    for (const next of [
      { ...current, fingerprint: "d".repeat(64) },
      { ...current, canManage: false },
    ]) {
      const request = vi
        .fn()
        .mockResolvedValueOnce({ receipt: null })
        .mockResolvedValueOnce(next);
      await expect(
        submitFleetAvailabilityAttempt(attempt, {
          request,
          assertCurrent() {},
        }),
      ).rejects.toBeInstanceOf(FleetAvailabilityAbsentConflict);
      expect(request.mock.calls.every((call) => call[0] === "GET")).toBe(true);
    }
  });
  it("rejects changed actor, interval, and physical proof in recovered receipts", async () => {
    for (const changed of [
      { ...receipt, actorUserId: 1073 },
      {
        ...receipt,
        record: { ...receipt.record, endsAt: "2026-10-08T20:00:00.000Z" },
      },
      { ...receipt, physicalReadinessVerified: true },
    ]) {
      const request = vi.fn().mockResolvedValue({ receipt: changed });
      await expect(
        submitFleetAvailabilityAttempt(attempt, {
          request,
          assertCurrent() {},
        }),
      ).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it("fences an account change after the receipt request before exposing results", async () => {
    const assertCurrent = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("context_changed");
      });
    const request = vi.fn().mockResolvedValue({ receipt });
    await expect(
      submitFleetAvailabilityAttempt(attempt, { request, assertCurrent }),
    ).rejects.toThrow("context_changed");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid calendar dates and reversed intervals before creating a command", () => {
    expect(() =>
      fleetAvailabilityLocalWindow("2026-02-30T10:00", "2026-03-01T11:00"),
    ).toThrow();
    expect(() =>
      fleetAvailabilityLocalWindow("2026-10-08T12:00", "2026-10-08T11:00"),
    ).toThrow();
  });
});
