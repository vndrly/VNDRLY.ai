import { describe, it, expect } from "vitest";
import {
  makeShiftAttempt,
  matchingShift,
  createdShiftId,
  recoverCreatedShift,
} from "./shift-scheduling";
const id = "10000000-0000-4000-8000-000000000001";
const payload = {
  title: "Synthetic shift",
  startsAt: "2026-10-08T18:00:00Z",
  endsAt: "2026-10-08T19:00:00Z",
  timezone: "America/Chicago",
  assigneeUserIds: [8],
  open: false as const,
  qualificationCodes: [],
};
const attempt = () =>
  makeShiftAttempt(6, { type: "vendor", id: 11 }, payload, id);
const row = {
  id,
  ownerOrgType: "vendor",
  ownerOrgId: 11,
  createdById: 6,
  ...payload,
  version: 1,
};
describe("exact shift review", () => {
  it("retains actual requested times and normalized named assignment", () => {
    const a = attempt();
    expect(a.body.payload.startsAt).toBe(payload.startsAt);
    expect(a.body.expectedVersion).toBeNull();
    expect(
      createdShiftId(
        {
          operationId: id,
          appliedAt: "2026-10-07T18:00:00Z",
          replayed: false,
          resource: row,
        },
        a,
      ),
    ).toBe(id);
  });
  it("rejects partial Gate context, reversed interval and different saved qualification", () => {
    expect(() =>
      makeShiftAttempt(
        6,
        { type: "vendor", id: 11 },
        { ...payload, siteLocationId: 5 },
        id,
      ),
    ).toThrow();
    expect(() =>
      makeShiftAttempt(
        6,
        { type: "vendor", id: 11 },
        { ...payload, endsAt: payload.startsAt },
        id,
      ),
    ).toThrow();
    expect(() =>
      matchingShift(
        {
          source: "vndrly",
          authority: "work_hub_shift",
          item: { ...row, qualificationCodes: ["Different"] },
        },
        attempt(),
      ),
    ).toThrow();
  });
  it("does not reconcile a foreign actor or cancelled shift as a matching recording", () => {
    for (const change of [
      { assigneeUserIds: [] },
      { open: true },
      { createdById: 7 },
      { ownerOrgId: 12 },
      { milestoneStatus: "cancelled" },
    ])
      expect(() =>
        matchingShift(
          {
            source: "vndrly",
            authority: "work_hub_shift",
            item: { ...row, ...change },
          },
          attempt(),
        ),
      ).toThrow();
  });
  it("requires exact operation receipt and current assignment/policy rather than a similar shift", async () => {
    const a = attempt(),
      receipt = {
        operationId: id,
        appliedAt: "2026-10-07T18:00:00Z",
        replayed: true,
        resource: row,
      };
    const calls: string[] = [];
    await expect(
      recoverCreatedShift(
        a,
        async (path) => {
          calls.push(path);
          return { receipt: null };
        },
        () => true,
      ),
    ).rejects.toThrow("creation_receipt_absent");
    expect(calls).toEqual(["/api/work-hub/shifts/operations/" + id]);
    await expect(
      recoverCreatedShift(
        a,
        async (path) =>
          path.includes("operations")
            ? { receipt }
            : {
                source: "vndrly",
                authority: "work_hub_shift",
                item: { ...row, assigneeUserIds: [] },
              },
        () => true,
      ),
    ).rejects.toThrow();
    await expect(
      recoverCreatedShift(
        a,
        async (path) =>
          path.includes("operations")
            ? { receipt }
            : { source: "vndrly", authority: "work_hub_shift", item: row },
        () => true,
      ),
    ).resolves.toBe(id);
  });
});
