import { describe, expect, it } from "vitest";
import { meetingTimer } from "./meeting-types";
describe("meeting duration", () => {
  it.each([1, 2, 3])("warns in the last ten minutes of a %i-hour target, including overtime", (hours) => {
    const start = "2026-09-09T14:00:00Z"; const end = new Date(Date.parse(start) + hours * 3600_000).toISOString();
    expect(meetingTimer(start, start, end, Date.parse(end) - 600_001).warning).toBe(false);
    expect(meetingTimer(start, start, end, Date.parse(end) - 600_000).warning).toBe(true);
    const overtime = meetingTimer(start, start, end, Date.parse(end) + 300_000);
    expect(overtime.warning).toBe(true); expect(overtime.overtimeMs).toBe(300_000); expect(overtime.progress).toBe(100);
  });
});
