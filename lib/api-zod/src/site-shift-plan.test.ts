import { describe, expect, it } from "vitest";
import { siteShiftPlanSchema, hasFullDayCoverage, shiftMinutes } from "./site-shift-plan";
const row = (start: string, end: string, weekdays = [1, 2, 3, 4, 5]) => ({ startsAtLocal: start, endsAtLocal: end, requiredCount: 3, weekdays });
describe("weekly site shift definitions", () => {
  it("preserves named pattern metadata and rejects invalid timezones", () => {
    const shift = { ...row("06:00", "18:00"), patternName: "Antelope Draw — Main Gate — Day", timezone: "America/Chicago" };
    const result = siteShiftPlanSchema.parse({ mode: "part_time", shifts: [shift] });
    expect(result.shifts[0]).toEqual(shift);
    expect(siteShiftPlanSchema.safeParse({ mode: "part_time", shifts: [{ ...shift, timezone: "not/a/timezone" }] }).success).toBe(false);
  });
  it("accepts overnight coverage anchored at the first shift", () => {
    expect(siteShiftPlanSchema.safeParse({ mode: "24_hour", shifts: [row("06:00", "14:00"), row("14:00", "22:00"), row("22:00", "06:00")] }).success).toBe(true);
    expect(shiftMinutes(row("22:00", "06:00"))).toBe(480);
  });
  it("supports a single 24-hour shift", () => expect(hasFullDayCoverage([row("06:00", "06:00")], 1)).toBe(true));
  it("rejects gaps, overlap, and missing days", () => {
    for (const shifts of [[row("06:00", "18:00"), row("19:00", "06:00")], [row("06:00", "19:00"), row("18:00", "06:00")], [row("06:00", "18:00"), row("18:00", "06:00", [1])]])
      expect(siteShiftPlanSchema.safeParse({ mode: "24_hour", shifts }).success).toBe(false);
  });
  it("permits part-time windows but requires valid clocks, headcount, and repeat days", () => {
    expect(siteShiftPlanSchema.safeParse({ mode: "part_time", shifts: [row("09:00", "13:00", [1, 3])] }).success).toBe(true);
    for (const patch of [{ requiredCount: 0 }, { requiredCount: 1.5 }, { weekdays: [] }, { startsAtLocal: "25:00" }])
      expect(siteShiftPlanSchema.safeParse({ mode: "part_time", shifts: [{ ...row("09:00", "13:00"), ...patch }] }).success).toBe(false);
  });
});
