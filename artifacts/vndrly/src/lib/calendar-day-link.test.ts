import { expect, it } from "vitest";
import { calendarDayFromSearch, calendarWorkerFromSearch, recordedShiftCalendarHref } from "./calendar-day-link";
it("opens the shift's local calendar day, including a different month or year", () => {
  expect(recordedShiftCalendarHref({ id: "clock-1", startedAt: new Date(2026, 0, 4, 23, 30).toISOString() })).toBe("/work-hub/calendar?day=2026-01-04&workday=clock-1");
  expect(calendarDayFromSearch("?day=2026-01-04&workday=clock-1")).toBe("2026-01-04");
});
it.each(["", "?day=2026-02-30", "?day=bad", "?day=2026-13-01"])("ignores invalid calendar day links %s", search => {
  expect(calendarDayFromSearch(search)).toBeNull();
});
it("preserves the chosen worker and local day without switching the signed-in user", () => {
  const href = recordedShiftCalendarHref({ id: "clock-2", startedAt: new Date(2026, 0, 4, 23, 30).toISOString() }, 28);
  expect(href).toBe("/work-hub/calendar?day=2026-01-04&workday=clock-2&worker=28");
  expect(calendarWorkerFromSearch(href.split("?")[1])).toEqual({ requested: true, userId: 28 });
  expect(calendarWorkerFromSearch("?day=2026-01-04")).toEqual({ requested: false, userId: null });
});
it.each(["?worker=bad", "?worker=-1", "?worker=0", "?worker=3.5", "?worker=4&worker=5", "?worker=99999999999999999"])("rejects an invalid worker instead of displaying my own calendar: %s", search => {
  expect(calendarWorkerFromSearch(search)).toEqual({ requested: true, userId: null });
});
