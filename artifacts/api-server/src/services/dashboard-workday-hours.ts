import { workdayTimeInRange, summarizeWorkday, type WorkdayEvent } from "@workspace/api-zod";

/** A read-time accrual, never a synthetic clock-out or a payroll adjustment. */
export function accruedWorkdayMilliseconds(history: WorkdayEvent[], start: string, end: string, at: Date) {
  const summary = summarizeWorkday(history);
  if (summary.reviewFlags.includes("clock_ahead_of_server")) throw new Error("workday.clock_needs_review");
  if (summary.endedAt) return workdayTimeInRange(history, start, end)!;
  let workingFrom: number | null = null, total = 0;
  const from = Date.parse(start), until = Math.min(at.getTime(), Date.parse(end));
  const add = (to: number) => { if (workingFrom !== null) total += Math.max(0, Math.min(until, to) - Math.max(from, workingFrom)); };
  for (const event of history) {
    const captured = Date.parse(event.capturedAt);
    if (event.kind === "start_shift" || event.kind === "end_unpaid_break") workingFrom = captured;
    else { add(captured); workingFrom = null; }
  }
  add(until);
  return total;
}
