import { describe, it, expect } from "vitest";
import { calendarViewDays, localDateKey } from "./calendar-views";
describe("Work Hub calendar ranges", () => {
  it("keeps day view on the chosen local day", () => {
    expect(calendarViewDays("2026-09-09", "day").map(localDateKey)).toEqual(["2026-09-09"]);
  });
  it("includes adjoining months in a full Sunday-start week", () => {
    expect(calendarViewDays("2026-10-01", "week").map(localDateKey)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  });
  it("does not truncate a week at the year boundary", () => {
    const days = calendarViewDays("2027-01-01", "week").map(localDateKey);
    expect(days[0]).toBe("2026-12-27"); expect(days[6]).toBe("2027-01-02");
  });
});
