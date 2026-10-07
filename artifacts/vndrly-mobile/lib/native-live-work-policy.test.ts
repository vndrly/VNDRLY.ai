import { describe, expect, it } from "vitest";
import { fleetLiveActivityBinding } from "./native-live-work-policy";
const account = {
  userId: 1073,
  companyId: 1107,
  membershipId: 800,
  sessionVersion: 2,
};
const run = {
  id: "70000000-0000-4000-8000-000000000001",
  companyId: 1107,
  driverUserId: 1073,
  status: "in_progress",
  phase: "traveling_to_pickup",
  version: 4,
  allowedActions: ["pause"],
};
const input = {
  account,
  expectedAccount: account,
  run,
  fetchedAt: 1000000,
  now: 1000000,
};
describe("canonical Live Activity binding", () => {
  it("uses actual current own duty with minimal protected content", () => {
    expect(fleetLiveActivityBinding(input)).toEqual({
      contextBinding: '["vndrly-live-work",1073,1107,800,2]',
      sessionId: run.id,
      recordVersion: 4,
      status: "active",
      updatedAt: 1000000,
      staleAt: 1300000,
      source: "canonical_fleet_run",
    });
  });
  it.each([
    { driverUserId: 1069 },
    { companyId: 609 },
    { status: "completed" },
    { phase: "paused" },
    { allowedActions: [] },
  ])("refuses mismatched or ended duty %j", (change) => {
    expect(() =>
      fleetLiveActivityBinding({ ...input, run: { ...run, ...change } }),
    ).toThrow("current_duty_required");
  });
  it("rejects stale reads and changed sessions even with the same user", () => {
    expect(() => fleetLiveActivityBinding({ ...input, now: 1400000 })).toThrow(
      "read_stale",
    );
    expect(() =>
      fleetLiveActivityBinding({
        ...input,
        account: { ...account, sessionVersion: 3 },
      }),
    ).toThrow("current_duty_required");
  });
});
