import { expect, it } from "vitest";
import { calendarDayFromSearch, recordedShiftCalendarHref } from "./calendar-day-link";
it("opens the shift's local calendar day, including a different month or year", () => {
  expect(recordedShiftCalendarHref({ id: "clock-1", startedAt: new Date(2026, 0, 4, 23, 30).toISOString() })).toBe("/work-hub/calendar?day=2026-01-04&workday=clock-1");
  expect(calendarDayFromSearch("?day=2026-01-04&workday=clock-1")).toBe("2026-01-04");
});
it.each(["", "?day=2026-02-30", "?day=bad", "?day=2026-13-01"])("ignores invalid calendar day links %s", search => {
  expect(calendarDayFromSearch(search)).toBeNull();
});
