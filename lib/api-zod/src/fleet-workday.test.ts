import { expect, it } from "vitest";
import * as api from "./index";
const work = api as unknown as Record<string, any>;
const companyId = 7,
  driverUserId = 27;
const scope = {
  companyId,
  userId: driverUserId,
  membershipId: 71,
  sessionVersion: 3,
};
const shiftId = "11111111-1111-4111-8111-111111111111";
function event(kind: string, hour: string, id: string) {
  const eventId = `22222222-2222-4222-8222-${Array.from(id)
    .map((char) => char.charCodeAt(0).toString(16))
    .join("")
    .padStart(12, "0")}`;
  return {
    id: eventId,
    shiftId,
    companyId,
    driverUserId,
    kind,
    capturedAt: `2026-10-16T${hour}:00Z`,
    receivedAt: "2026-10-17T04:00:00Z",
    source: "driver_report",
  };
}
it("requires an exact original identity and immutable operation for offline workday intent", () => {
  expect(work.FleetWorkdayCommandSchema).toBeDefined();
  const valid = {
    operationId: shiftId,
    shiftId,
    scope,
    action: "start_shift",
    capturedAt: "2026-10-16T12:00:00Z",
    timezone: "America/Chicago",
  };
  expect(work.FleetWorkdayCommandSchema.safeParse(valid).success).toBe(true);
  for (const bad of [
    { ...valid, scope: { ...scope, membershipId: null } },
    { ...valid, source: "verified_eld" },
    { ...valid, action: "run_closed" },
    { ...valid, timezone: "Invented/Zone" },
  ])
    expect(work.FleetWorkdayCommandSchema.safeParse(bad).success).toBe(false);
});
it("counts reported yard time and time between runs without using run schedules as hours", () => {
  expect(work.summarizeFleetWorkday).toBeDefined();
  const events = [
    event("start_shift", "12:00", "start"),
    event("end_shift", "22:30", "end"),
  ];
  expect(work.summarizeFleetWorkday(events)).toMatchObject({
    state: "ended",
    elapsedMilliseconds: 37800000,
    reportedWorkMilliseconds: 37800000,
    unpaidBreakMilliseconds: 0,
    payrollApproved: false,
    reviewFlags: [],
  });
});
it("subtracts only an explicitly reported unpaid break and keeps original cross-midnight timestamps", () => {
  expect(work.summarizeFleetWorkday).toBeDefined();
  const events = [
    event("start_shift", "22:00", "s"),
    {
      ...event("start_unpaid_break", "23:00", "b"),
      receivedAt: "2026-10-17T06:00:00Z",
    },
    {
      ...event("end_unpaid_break", "23:30", "be"),
      receivedAt: "2026-10-17T06:00:00Z",
    },
    {
      ...event("end_shift", "23:59", "e"),
      capturedAt: "2026-10-17T02:00:00Z",
      receivedAt: "2026-10-17T06:00:00Z",
    },
  ];
  expect(work.summarizeFleetWorkday(events)).toMatchObject({
    state: "ended",
    elapsedMilliseconds: 14400000,
    reportedWorkMilliseconds: 12600000,
    unpaidBreakMilliseconds: 1800000,
    payrollApproved: false,
  });
});
it("does not invent an end time for an open workday, even when a run is closed", () => {
  expect(work.summarizeFleetWorkday).toBeDefined();
  expect(
    work.summarizeFleetWorkday([event("start_shift", "12:00", "s")]),
  ).toMatchObject({
    state: "on_shift",
    endedAt: null,
    elapsedMilliseconds: null,
    reportedWorkMilliseconds: null,
    reviewFlags: ["missing_shift_end"],
  });
});
it("preserves future device time visibly and does not pretend clock-skewed reports are payroll approved", () => {
  const result = work.summarizeFleetWorkday([
    {
      ...event("start_shift", "12:00", "s"),
      receivedAt: "2026-10-16T11:00:00Z",
    },
    { ...event("end_shift", "13:00", "e"), receivedAt: "2026-10-16T11:10:00Z" },
  ]);
  expect(result).toMatchObject({
    reportedWorkMilliseconds: 3600000,
    payrollApproved: false,
    reviewFlags: ["clock_ahead_of_server"],
  });
});
it("only ends a reported break at an explicit break end or shift end", () => {
  const result = work.summarizeFleetWorkday([
    event("start_shift", "12:00", "s"),
    event("start_unpaid_break", "13:00", "b"),
    event("end_shift", "13:30", "e"),
  ]);
  expect(result).toMatchObject({
    state: "ended",
    unpaidBreakMilliseconds: 1800000,
    reportedWorkMilliseconds: 3600000,
  });
  expect(() =>
    work.summarizeFleetWorkday([
      event("start_shift", "12:00", "s"),
      event("start_unpaid_break", "13:00", "b"),
      event("start_unpaid_break", "13:15", "bb"),
    ]),
  ).toThrow();
});
it("rejects mixed company/driver/shift records, duplicate identities and impossible chronology", () => {
  expect(work.summarizeFleetWorkday).toBeDefined();
  for (const events of [
    [event("end_shift", "12:00", "e")],
    [event("start_shift", "13:00", "s"), event("end_shift", "12:00", "e")],
    [
      event("start_shift", "12:00", "s"),
      { ...event("end_shift", "13:00", "e"), companyId: 8 },
    ],
    [event("start_shift", "12:00", "s"), event("end_shift", "13:00", "s")],
  ])
    expect(() => work.summarizeFleetWorkday(events)).toThrow();
});
it("validates a scoped canonical receipt and rejects mismatched shift or event identities", () => {
  expect(work.FleetWorkdayReceiptSchema).toBeDefined();
  const savedEvent = event("start_shift", "12:00", "s"),
    summary = work.summarizeFleetWorkday([savedEvent]);
  const receipt = {
    operationId: savedEvent.id,
    shiftId,
    version: 1,
    event: savedEvent,
    summary,
  };
  expect(work.FleetWorkdayReceiptSchema.safeParse(receipt).success).toBe(true);
  for (const changed of [
    { ...receipt, operationId: shiftId },
    { ...receipt, summary: { ...summary, driverUserId: 999 } },
    { ...receipt, sourceReference: "private" },
  ])
    expect(work.FleetWorkdayReceiptSchema.safeParse(changed).success).toBe(
      false,
    );
});
it("allocates an overnight workday to the requested day without double-counting its full shift", () => {
  expect(work.fleetWorkdayTimeInRange).toBeDefined();
  const history=[event("start_shift","23:00","s"),{...event("end_shift","23:59","e"),capturedAt:"2026-10-17T02:00:00Z"}];
  expect(work.fleetWorkdayTimeInRange(history,"2026-10-16T00:00:00Z","2026-10-17T00:00:00Z")).toBe(3600000);
  expect(work.fleetWorkdayTimeInRange(history,"2026-10-17T00:00:00Z","2026-10-18T00:00:00Z")).toBe(7200000);
});
it("clips only reported working segments around unpaid breaks, never inventing the end of an open day", () => {
  expect(work.fleetWorkdayTimeInRange).toBeDefined();
  const history=[event("start_shift","12:00","s"),event("start_unpaid_break","13:00","b"),event("end_unpaid_break","14:00","be"),event("end_shift","16:00","e")];
  expect(work.fleetWorkdayTimeInRange(history,"2026-10-16T12:30:00Z","2026-10-16T14:30:00Z")).toBe(3600000);
  expect(work.fleetWorkdayTimeInRange([history[0]],"2026-10-16T12:00:00Z","2026-10-16T16:00:00Z")).toBeNull();
});
