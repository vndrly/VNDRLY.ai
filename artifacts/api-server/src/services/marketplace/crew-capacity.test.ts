import { describe, expect, it } from "vitest";
import { peakReservedCrews } from "./crew-capacity";

const at = (hour: string) => new Date(`2026-11-01T${hour}:00Z`);
const reservation = (start: string, end: string, crews = 1) => ({
  start: at(start),
  end: at(end),
  crews,
});

describe("peak reserved crew capacity in a requested window", () => {
  it("allows one additional crew across adjacent 09–10 and 10–11 reservations at capacity two", () => {
    const peak = peakReservedCrews(at("09:00"), at("11:00"), [
      reservation("09:00", "10:00"),
      reservation("10:00", "11:00"),
    ]);
    expect(peak).toBe(1);
    expect(peak + 1 <= 2).toBe(true);
  });
  it("blocks an additional crew when actual overlapping peak already uses capacity two", () => {
    const peak = peakReservedCrews(at("09:00"), at("11:00"), [
      reservation("09:00", "10:30"),
      reservation("10:00", "11:00"),
    ]);
    expect(peak).toBe(2);
    expect(peak + 1 <= 2).toBe(false);
  });
  it("clips intervals to the requested window and excludes touching endpoints", () => {
    expect(
      peakReservedCrews(at("09:00"), at("11:00"), [
        reservation("08:00", "09:00", 9),
        reservation("11:00", "12:00", 9),
        reservation("08:30", "09:30", 2),
        reservation("10:30", "11:30", 3),
      ]),
    ).toBe(3);
  });
  it("counts nested weighted reservations and is order independent", () => {
    const rows = [
      reservation("08:00", "12:00", 2),
      reservation("09:15", "09:45", 3),
      reservation("09:30", "10:30", 1),
    ];
    expect(peakReservedCrews(at("09:00"), at("11:00"), rows)).toBe(6);
    expect(peakReservedCrews(at("09:00"), at("11:00"), rows.reverse())).toBe(6);
    expect(peakReservedCrews(at("09:00"), at("11:00"), [])).toBe(0);
  });
});
