import { expect, it, vi } from "vitest";
import { summarizeWorkday, type WorkdayEvent } from "@workspace/api-zod";
import { monthlyShiftHoursRange, readDashboardShiftHours, readCompanyDashboardHours, readEmployeeCalendarContext } from "./dashboard-shift-hours";

const owner = { type: "vendor" as const, id: 1 }, userId = 7;
const scope = { owner, userId, start: "2026-10-23T05:00:00.000Z", end: "2026-10-24T05:00:00.000Z" };
const shiftId = "11111111-1111-4111-8111-111111111111";
function events(rows: Array<[WorkdayEvent["kind"], string]>): WorkdayEvent[] {
  return rows.map(([kind, at], index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, shiftId, owner, workerUserId: userId, kind, capturedAt: at, receivedAt: at, source: "worker_report" }));
}
function snapshot(history: WorkdayEvent[]) { return { id: shiftId, version: history.length, owner, workerUserId: userId, timezone: "America/Chicago", summary: summarizeWorkday(history) }; }
function page(items: unknown[], nextCursor: string | null = null) { return { items, range: { start: scope.start, end: scope.end }, nextCursor }; }
const closed = { ...snapshot(events([["start_shift", "2026-10-23T12:00:00Z"], ["end_shift", "2026-10-23T14:30:00Z"]])), reportedWorkMillisecondsInRange: 9000000 };
it("binds an employee calendar to the actual viewer, employer and selected employee", async () => {
  const result = { owner, viewerUserId: userId, employee: { userId: 8, name: "Alex" } };
  expect(await readEmployeeCalendarContext(scope, 8, vi.fn().mockResolvedValue(result))).toEqual(result);
  for (const bad of [{ ...result, viewerUserId: 8 }, { ...result, owner: { type: "partner", id: 1 } }, { ...result, employee: { ...result.employee, userId: 9 } }]) {
    await expect(readEmployeeCalendarContext(scope, 8, vi.fn().mockResolvedValue(bad))).rejects.toThrow();
  }
});

it("rolls the displayed period on the first without touching recorded clock data", () => {
  expect(monthlyShiftHoursRange(new Date(2026, 9, 31, 23, 59))).toEqual({ start: new Date(2026, 9, 1).toISOString(), end: new Date(2026, 10, 1).toISOString() });
  expect(monthlyShiftHoursRange(new Date(2026, 10, 1))).toEqual({ start: new Date(2026, 10, 1).toISOString(), end: new Date(2026, 11, 1).toISOString() });
});
it("reconciles company totals including mine once, and rejects stale scopes or duplicate employee totals", async () => {
  const result = { owner, viewerUserId: userId, observedAt: "2026-10-23T20:00:00Z", range: { start: scope.start, end: scope.end }, mineMilliseconds: 3600000, totalMilliseconds: 10800000,
    employees: [{ userId, name: "Me", milliseconds: 3600000 }, { userId: 8, name: "Alex", milliseconds: 7200000 }] };
  expect(await readCompanyDashboardHours(scope, vi.fn().mockResolvedValue(result))).toEqual(result);
  for (const bad of [{ ...result, viewerUserId: 9 }, { ...result, owner: { type: "vendor", id: 99 } }, { ...result, range: { ...result.range, start: "2026-09-01T00:00:00Z" } }, { ...result, employees: [...result.employees, result.employees[0]] }, { ...result, totalMilliseconds: 123 }]) {
    await expect(readCompanyDashboardHours(scope, vi.fn().mockResolvedValue(bad))).rejects.toThrow();
  }
});
it.each([[2026, 11, 2027, 0], [2028, 1, 2028, 2]])("handles month/year/leap boundaries for %i/%i", (year, month, nextYear, nextMonth) => {
  expect(monthlyShiftHoursRange(new Date(year, month, 16))).toEqual({ start: new Date(year, month, 1).toISOString(), end: new Date(nextYear, nextMonth, 1).toISOString() });
});

it("sums canonical closed hours across every page instead of task age or scheduled hours", async () => {
  const secondId = "22222222-2222-4222-8222-222222222222";
  const request = vi.fn().mockResolvedValueOnce(page([closed], "599")).mockResolvedValueOnce(page([{ ...closed, id: secondId, summary: { ...closed.summary, shiftId: secondId }, reportedWorkMillisecondsInRange: 3600000 }]));
  const result = await readDashboardShiftHours(scope, request);
  expect(result).toMatchObject({ milliseconds: 12600000, state: null });
  expect(result.shifts.map(shift => ({ id: shift.id, milliseconds: shift.milliseconds }))).toEqual([{ id: shiftId, milliseconds: 9000000 }, { id: secondId, milliseconds: 3600000 }]);
  expect(request.mock.calls[1][0]).toContain("after=599");
});
it("counts a running shift from its saved events while excluding unpaid breaks", async () => {
  const history = events([["start_shift", "2026-10-23T15:00:00Z"], ["start_unpaid_break", "2026-10-23T16:00:00Z"], ["end_unpaid_break", "2026-10-23T16:30:00Z"]]);
  const request = vi.fn().mockResolvedValueOnce(page([{ ...snapshot(history), reportedWorkMillisecondsInRange: null }])).mockResolvedValueOnce({ ...snapshot(history), events: history });
  expect(await readDashboardShiftHours(scope, request, Date.parse("2026-10-23T18:00:00Z"))).toMatchObject({ milliseconds: 9000000, state: "on_shift", shifts: [{ id: shiftId, milliseconds: 9000000, state: "on_shift", endedAt: null }] });
  expect(request.mock.calls.every(([, method]) => method === undefined)).toBe(true);
});
it("stops the running count during a recorded unpaid break", async () => {
  const history = events([["start_shift", "2026-10-23T15:00:00Z"], ["start_unpaid_break", "2026-10-23T16:00:00Z"]]);
  const request = vi.fn().mockResolvedValueOnce(page([{ ...snapshot(history), reportedWorkMillisecondsInRange: null }])).mockResolvedValueOnce({ ...snapshot(history), events: history });
  expect(await readDashboardShiftHours(scope, request, Date.parse("2026-10-23T18:00:00Z"))).toMatchObject({ milliseconds: 3600000, state: "on_break", shifts: [{ milliseconds: 3600000, state: "on_break" }] });
});
it("clips an overnight active shift to today's local-day boundary", async () => {
  const history = events([["start_shift", "2026-10-22T23:00:00Z"]]);
  const request = vi.fn().mockResolvedValueOnce(page([{ ...snapshot(history), reportedWorkMillisecondsInRange: null }])).mockResolvedValueOnce({ ...snapshot(history), events: history });
  expect(await readDashboardShiftHours(scope, request, Date.parse("2026-10-23T08:00:00Z"))).toMatchObject({ milliseconds: 10800000, state: "on_shift", shifts: [{ milliseconds: 10800000, startedAt: "2026-10-22T23:00:00Z" }] });
});
it("uses a real clock-out recorded while the hours request was in flight", async () => {
  const history = events([["start_shift", "2026-10-23T12:00:00Z"], ["end_shift", "2026-10-23T14:30:00Z"]]);
  const request = vi.fn().mockResolvedValueOnce(page([{ ...closed, reportedWorkMillisecondsInRange: null }])).mockResolvedValueOnce({ ...snapshot(history), events: history });
  expect(await readDashboardShiftHours(scope, request, Date.parse("2026-10-23T18:00:00Z"))).toMatchObject({ milliseconds: 9000000, state: null, shifts: [{ endedAt: "2026-10-23T14:30:00Z", state: "ended" }] });
});
it("reports zero only after a successful empty read and propagates unavailable data", async () => {
  expect(await readDashboardShiftHours(scope, vi.fn().mockResolvedValue(page([])))).toEqual({ milliseconds: 0, state: null, shifts: [] });
  await expect(readDashboardShiftHours(scope, vi.fn().mockRejectedValue(Error("Offline")))).rejects.toThrow("Offline");
});
it.each([
  { ...closed, workerUserId: 8 },
  { ...closed, owner: { type: "partner", id: 1 } },
  { ...closed, summary: { ...closed.summary, workerUserId: 8 } },
  { ...closed, summary: { ...closed.summary, reviewFlags: ["clock_ahead_of_server"] } },
])("rejects a changed worker, employer or unreliable clock", async item => {
  await expect(readDashboardShiftHours(scope, vi.fn().mockResolvedValue(page([item])))).rejects.toThrow();
});
