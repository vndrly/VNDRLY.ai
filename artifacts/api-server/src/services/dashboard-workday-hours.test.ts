import { expect, it } from "vitest";
import type { WorkdayEvent } from "@workspace/api-zod";
import { accruedWorkdayMilliseconds } from "./dashboard-workday-hours";
const hour = 3600000, start = "2026-10-01T00:00:00Z", end = "2026-11-01T00:00:00Z";
function history(rows: [WorkdayEvent["kind"], string][]): WorkdayEvent[] {
  return rows.map(([kind, at], index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, shiftId: "11111111-1111-4111-8111-111111111111", owner: { type: "vendor", id: 1 }, workerUserId: 7, source: "worker_report", kind, capturedAt: at, receivedAt: at }));
}
it("accrues active shifts using the same unpaid-break and period boundaries without persisting an end", () => {
  const events = history([["start_shift", "2026-09-30T23:00:00Z"], ["start_unpaid_break", "2026-10-01T01:00:00Z"], ["end_unpaid_break", "2026-10-01T01:30:00Z"]]);
  expect(accruedWorkdayMilliseconds(events, start, end, new Date("2026-10-01T03:00:00Z"))).toBe(2.5 * hour);
  expect(events.map(event => event.kind)).not.toContain("end_shift");
  expect(accruedWorkdayMilliseconds(events.slice(0, 2), start, end, new Date("2026-10-01T03:00:00Z"))).toBe(hour);
  expect(accruedWorkdayMilliseconds(history([["start_shift", "2026-10-31T23:00:00Z"]]), start, end, new Date("2026-11-01T03:00:00Z"))).toBe(hour);
});
it("keeps completed time fixed at the actual saved end, even when the current time advances", () => {
  const events = history([["start_shift", "2026-10-01T08:00:00Z"], ["end_shift", "2026-10-01T10:00:00Z"]]);
  expect(accruedWorkdayMilliseconds(events, start, end, new Date("2026-12-01T00:00:00Z"))).toBe(2 * hour);
});
