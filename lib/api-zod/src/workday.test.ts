import { expect, it } from "vitest";
import * as api from "./index";
const clock = api as unknown as Record<string, any>;
const shiftId = "11111111-1111-4111-8111-111111111111";
const owner = { type: "vendor", id: 7 },
  scope = { owner, userId: 27, membershipId: 71, sessionVersion: 3 };
const start = {
  id: shiftId,
  shiftId,
  owner,
  workerUserId: 27,
  kind: "start_shift",
  capturedAt: "2026-10-16T12:00:00Z",
  receivedAt: "2026-10-16T12:00:01Z",
  source: "worker_report",
};
it("uses an explicit employer identity and one command independent of portal", () => {
  expect(clock.WorkdayCommandSchema).toBeDefined();
  const body = {
    operationId: shiftId,
    shiftId,
    scope,
    action: "start_shift",
    capturedAt: start.capturedAt,
    timezone: "America/Chicago",
  };
  expect(clock.WorkdayCommandSchema.safeParse(body).success).toBe(true);
  for (const invalid of [
    { ...body, scope: { ...scope, owner: { id: 7 } } },
    { ...body, portal: "fleet" },
    { ...body, action: "logout" },
    { ...body, scope: { ...scope, membershipId: null } },
  ])
    expect(clock.WorkdayCommandSchema.safeParse(invalid).success).toBe(false);
});
it("keeps the same workday across portal changes and counts yard time without a run, ticket or site", () => {
  expect(clock.summarizeWorkday).toBeDefined();
  const end = {
    ...start,
    id: "22222222-2222-4222-8222-222222222222",
    kind: "end_shift",
    capturedAt: "2026-10-16T22:30:00Z",
    receivedAt: "2026-10-16T22:30:01Z",
  };
  expect(clock.summarizeWorkday([start, end])).toMatchObject({
    owner,
    workerUserId: 27,
    state: "ended",
    reportedWorkMilliseconds: 37800000,
    payrollApproved: false,
    source: "worker_report",
  });
});
it("never merges equal numeric partner/vendor IDs into one employer workday", () => {
  expect(clock.summarizeWorkday).toBeDefined();
  expect(() =>
    clock.summarizeWorkday([
      start,
      {
        ...start,
        id: "22222222-2222-4222-8222-222222222222",
        kind: "end_shift",
        owner: { type: "partner", id: 7 },
        capturedAt: "2026-10-16T22:30:00Z",
      },
    ]),
  ).toThrow();
});
