import { expect, it } from "vitest";
import * as api from "./index";
const functions = api as unknown as Record<string, any>;
it("resolves commercial wall time in its chosen IANA zone, independent of the device zone", () => {
  expect(functions.fleetWallTimeToInstant).toBeDefined();
  for (const [wall, zone, instant] of [
    ["2026-07-01T10:00", "America/Chicago", "2026-07-01T15:00:00.000Z"],
    ["2026-12-01T10:00", "America/Chicago", "2026-12-01T16:00:00.000Z"],
    ["2026-07-01T10:00", "America/Denver", "2026-07-01T16:00:00.000Z"],
    ["2026-07-01T10:00", "Asia/Kathmandu", "2026-07-01T04:15:00.000Z"],
    ["2028-02-29T10:00:12.345", "UTC", "2028-02-29T10:00:12.345Z"],
  ])
    expect(functions.fleetWallTimeToInstant(wall, zone)).toEqual({
      status: "resolved",
      instant,
    });
});
it("does not guess a DST fold, nonexistent clock time, invalid calendar date or unknown zone", () => {
  expect(functions.fleetWallTimeToInstant).toBeDefined();
  expect(
    functions.fleetWallTimeToInstant("2026-11-01T01:30", "America/Chicago"),
  ).toEqual({
    status: "ambiguous",
    candidates: ["2026-11-01T06:30:00.000Z", "2026-11-01T07:30:00.000Z"],
  });
  expect(
    functions.fleetWallTimeToInstant("2026-03-08T02:30", "America/Chicago"),
  ).toEqual({ status: "nonexistent" });
  for (const wall of [
    "2026-02-30T12:00",
    "2026-02-29T10:00",
    "2026-12-01T25:00",
    "not-a-date",
  ])
    expect(functions.fleetWallTimeToInstant(wall, "UTC")).toEqual({
      status: "invalid",
    });
  expect(
    functions.fleetWallTimeToInstant("2026-07-01T10:00", "Unknown/Zone"),
  ).toEqual({ status: "invalid" });
});
it("formats saved planned instants in their recorded zone and preserves nonzero seconds", () => {
  expect(functions.fleetInstantToWallTime).toBeDefined();
  expect(
    functions.fleetInstantToWallTime("2026-07-01T15:00:00Z", "America/Chicago"),
  ).toBe("2026-07-01T10:00");
  expect(
    functions.fleetInstantToWallTime(
      "2026-07-01T15:00:12.345Z",
      "America/Chicago",
    ),
  ).toBe("2026-07-01T10:00:12.345");
  expect(functions.fleetInstantToWallTime("bad", "America/Chicago")).toBeNull();
});
