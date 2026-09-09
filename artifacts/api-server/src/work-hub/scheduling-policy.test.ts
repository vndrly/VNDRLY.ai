import { describe, expect, it } from "vitest";
import {
  canManageSchedulingType,
  fitsAvailability,
  overlaps,
  schedulingSlots,
} from "./scheduling-policy";
const d = (time: string) => new Date(`2027-03-14T${time}:00Z`);
describe("meeting scheduling boundaries", () => {
  it("allows adjacent reservations but rejects partial or enclosing overlaps", () => {
    expect(overlaps(d("10:00"), d("10:30"), d("10:30"), d("11:00"))).toBe(
      false,
    );
    expect(overlaps(d("10:00"), d("10:30"), d("10:15"), d("11:00"))).toBe(true);
    expect(overlaps(d("10:00"), d("12:00"), d("10:30"), d("11:00"))).toBe(true);
  });
  it("requires the complete reservation inside an available window", () => {
    const windows = [{ startsAt: d("10:00"), endsAt: d("11:00") }];
    expect(fitsAvailability(d("10:30"), d("11:00"), windows)).toBe(true);
    expect(fitsAvailability(d("10:45"), d("11:15"), windows)).toBe(false);
  });
  it("hides busy and past slots and deduplicates overlapping windows", () => {
    const window = { startsAt: d("10:00"), endsAt: d("12:00") };
    expect(
      schedulingSlots(
        [window, window],
        30,
        [{ startsAt: d("11:00"), endsAt: d("11:30") }],
        d("10:00"),
      ),
    ).toEqual([d("10:30").toISOString(), d("11:30").toISOString()]);
  });
  it("does not give company admins control of another person's private schedule", () => {
    expect(canManageSchedulingType(1, 2, "personal", true)).toBe(false);
    expect(canManageSchedulingType(1, 2, "shared", true)).toBe(true);
    expect(canManageSchedulingType(1, 2, "shared", false)).toBe(false);
    expect(canManageSchedulingType(2, 2, "personal", false)).toBe(true);
  });
});
