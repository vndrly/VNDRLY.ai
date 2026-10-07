import { FleetRecordedTimingSchema, type FleetRun, type FleetRecordedTiming } from "@workspace/api-zod";

/** Saved server acceptance times describe record intervals, never physical duty or billable detention. */
export function summarizeRecordedFleetTiming(runs: readonly FleetRun[]): FleetRecordedTiming {
  const totals: FleetRecordedTiming = {
    source: "server_recorded_event_times", physicalPresenceVerified: false, contractualTimelinessVerified: false,
    eligibleRunCount: 0, invalidSequenceCount: 0, elapsedMinutes: 0, pausedMinutes: 0, activeMinutes: 0,
    plannedStartCount: 0, lateStartCount: 0, startOffsetTotalMinutes: 0,
    plannedFinishCount: 0, lateFinishCount: 0, finishOffsetTotalMinutes: 0,
  };
  for (const run of runs) {
    const startIndex = run.events.findIndex(event => event.type === "start");
    if (startIndex < 0) continue;
    const closeIndex = run.events.findIndex((event, index) => index > startIndex && event.type === "submit_closeout");
    if (closeIndex < 0) continue;
    const interval = run.events.slice(startIndex, closeIndex + 1);
    const times = interval.map(event => Date.parse(event.recordedAt));
    let invalid = times.some((time, index) => !Number.isFinite(time) || (index > 0 && time < times[index - 1]));
    let pausedAt: number | null = null, pausedMs = 0;
    interval.forEach((event, index) => {
      if (event.type === "pause") {
        if (pausedAt !== null) invalid = true;
        else pausedAt = times[index];
      } else if (event.type === "resume") {
        if (pausedAt === null) invalid = true;
        else { pausedMs += times[index] - pausedAt; pausedAt = null; }
      } else if (index > 0 && event.type === "start") invalid = true;
    });
    const started = times[0], closed = times.at(-1)!;
    if (pausedAt !== null) pausedMs += closed - pausedAt;
    const elapsedMs = closed - started;
    if (invalid || pausedMs < 0 || pausedMs > elapsedMs) { totals.invalidSequenceCount++; continue; }
    totals.eligibleRunCount++;
    totals.elapsedMinutes += elapsedMs / 60000;
    totals.pausedMinutes += pausedMs / 60000;
    totals.activeMinutes += (elapsedMs - pausedMs) / 60000;
    if (run.schedule) {
      const startOffset = (started - Date.parse(run.schedule.plannedStartAt)) / 60000;
      const finishOffset = (closed - Date.parse(run.schedule.plannedEndAt)) / 60000;
      totals.plannedStartCount++; totals.startOffsetTotalMinutes += startOffset;
      totals.plannedFinishCount++; totals.finishOffsetTotalMinutes += finishOffset;
      if (startOffset > 0) totals.lateStartCount++;
      if (finishOffset > 0) totals.lateFinishCount++;
    }
  }
  return FleetRecordedTimingSchema.parse(totals);
}
