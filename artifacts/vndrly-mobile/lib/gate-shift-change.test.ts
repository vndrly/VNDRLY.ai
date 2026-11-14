import { it, expect } from "vitest";
import {
  prepareGateShiftChange,
  verifyGateShiftChange,
  gateShiftClock,
  type EditableGateShift,
} from "./gate-shift-change";
const shift: EditableGateShift = {
  id: "s",
  ownerOrgType: "vendor",
  ownerOrgId: 2,
  version: 3,
  siteLocationId: 4,
  gateStationId: "g",
  title: "Day watch",
  startsAt: "2026-11-15T12:00:00Z",
  endsAt: "2026-11-16T00:00:00Z",
  timezone: "America/Chicago",
};
it("uses the shift timezone independently of the device", () => {
  const body = prepareGateShiftChange(
    shift,
    {
      action: "reschedule",
      title: "Day watch",
      startDate: "2026-11-15",
      startTime: "07:00",
      endDate: "2026-11-15",
      endTime: "17:00",
    },
    "operation",
  );
  expect(body.payload.startsAt).toBe("2026-11-15T13:00:00.000Z");
  expect(body.payload.endsAt).toBe("2026-11-15T23:00:00.000Z");
  expect(body.expectedVersion).toBe(3);
  expect(body.context).toEqual({ kind: "gate", id: 4 });
  expect(gateShiftClock(shift.startsAt, shift.timezone)).toEqual({
    date: "2026-11-15",
    time: "06:00",
  });
});
it.each([
  ["2026-03-08", "02:30"],
  ["2026-11-01", "01:30"],
])(
  "rejects missing or repeated daylight-saving clock time %s %s",
  (date, time) => {
    expect(() =>
      prepareGateShiftChange(
        shift,
        {
          action: "reschedule",
          title: "Shift",
          startDate: date,
          startTime: time,
          endDate: date,
          endTime: "06:00",
        },
        "op",
      ),
    ).toThrow(/ambiguous/);
  },
);
it("only accepts a new saved version with matching company, gate and requested result", () => {
  const body = prepareGateShiftChange(shift, { action: "cancel" }, "op");
  expect(() =>
    verifyGateShiftChange({ ...shift, version: 4 }, shift, body),
  ).toThrow(/Cancellation/);
  expect(() =>
    verifyGateShiftChange(
      { ...shift, version: 4, milestoneStatus: "cancelled", ownerOrgId: 9 },
      shift,
      body,
    ),
  ).toThrow(/verified/);
  expect(
    verifyGateShiftChange(
      { ...shift, version: 4, milestoneStatus: "cancelled" },
      shift,
      body,
    ).milestoneStatus,
  ).toBe("cancelled");
});
