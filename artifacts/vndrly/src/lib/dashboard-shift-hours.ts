import { z } from "zod/v4";
import { WorkdayEventSchema, WorkdayHistoryPageSchema, WorkdaySnapshotSchema, sameWorkdayOwner, summarizeWorkday, type WorkdayOwner } from "@workspace/api-zod";

const DetailSchema = z.object({ ...WorkdaySnapshotSchema.shape, events: z.array(WorkdayEventSchema) });
type Scope = { userId: number; owner: WorkdayOwner; start: string; end: string };
export type RecordedShiftHours = { id: string; startedAt: string; endedAt: string | null; timezone: string; milliseconds: number; state: "on_shift" | "on_break" | "ended" };
export function formatRecordedHours(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
/** Temporary calendar-month boundary. Payroll processing will own this later;
 * see docs/payroll-hours-integration.md. Never clear the underlying clock records. */
export function monthlyShiftHoursRange(now = new Date()) {
  return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() };
}

/** Read only the worker's canonical clock. Open time is a running total, never a saved clock-out. */
export async function readDashboardShiftHours(scope: Scope, request: (path: string) => Promise<unknown>, now = Date.now()) {
  let milliseconds = 0, state: "on_shift" | "on_break" | null = null, after: string | null = null;
  const shifts: RecordedShiftHours[] = [];
  const assertIdentity = (value: { workerUserId: number; owner: WorkdayOwner }) => {
    if (value.workerUserId !== scope.userId || !sameWorkdayOwner(value.owner, scope.owner)) throw Error("Workday account changed");
  };
  do {
    const query = new URLSearchParams({ start: scope.start, end: scope.end, limit: "100", ...(after ? { after } : {}) });
    const page = WorkdayHistoryPageSchema.parse(await request(`/workday/workers/${scope.userId}?${query}`));
    if (Date.parse(page.range.start) !== Date.parse(scope.start) || Date.parse(page.range.end) !== Date.parse(scope.end)) throw Error("Workday range changed");
    for (const item of page.items) {
      assertIdentity(item);
      assertIdentity(item.summary);
      if (item.id !== item.summary.shiftId) throw Error("Workday shift changed");
      if (item.summary.reviewFlags.includes("clock_ahead_of_server")) throw Error("Workday clock needs review");
      if (item.reportedWorkMillisecondsInRange !== null) {
        milliseconds += item.reportedWorkMillisecondsInRange;
        shifts.push({ id: item.id, startedAt: item.summary.startedAt, endedAt: item.summary.endedAt, timezone: item.timezone, milliseconds: item.reportedWorkMillisecondsInRange, state: item.summary.state });
        continue;
      }
      const detail = DetailSchema.parse(await request(`/workday/shifts/${encodeURIComponent(item.id)}`));
      assertIdentity(detail);
      if (detail.id !== item.id) throw Error("Workday shift changed");
      const summary = summarizeWorkday(detail.events);
      assertIdentity(summary);
      if (summary.shiftId !== item.id || summary.reviewFlags.includes("clock_ahead_of_server")) throw Error("Workday clock needs review");
      if (!summary.endedAt) state = summary.state === "on_break" ? "on_break" : "on_shift";
      let shiftMilliseconds = 0;
      let workingFrom: number | null = null;
      const until = Math.min(now, Date.parse(scope.end)), from = Date.parse(scope.start);
      const addSegment = (end: number) => { if (workingFrom !== null) shiftMilliseconds += Math.max(0, Math.min(until, end) - Math.max(from, workingFrom)); };
      for (const event of detail.events) {
        const at = Date.parse(event.capturedAt);
        if (event.kind === "start_shift" || event.kind === "end_unpaid_break") workingFrom = at;
        else { addSegment(at); workingFrom = null; }
      }
      addSegment(until);
      milliseconds += shiftMilliseconds;
      shifts.push({ id: item.id, startedAt: summary.startedAt, endedAt: summary.endedAt, timezone: detail.timezone, milliseconds: shiftMilliseconds, state: summary.state });
    }
    if (page.nextCursor && page.nextCursor === after) throw Error("Workday history did not advance");
    after = page.nextCursor;
  } while (after);
  return { milliseconds, state, shifts: shifts.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)) };
}
