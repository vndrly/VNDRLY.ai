export type WatchedInterval = { startsAtMs: number; endsAtMs: number };

const MAX_HEARTBEAT_MS = 30_000;
const PLAYHEAD_TOLERANCE_MS = 1_500;

export function normalizeWatchedIntervals(intervals: WatchedInterval[], durationMs: number): WatchedInterval[] {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error("Invalid replay duration");
  const sorted = intervals.map((interval) => {
    if (!Number.isSafeInteger(interval.startsAtMs) || !Number.isSafeInteger(interval.endsAtMs) || interval.startsAtMs < 0 || interval.endsAtMs <= interval.startsAtMs || interval.endsAtMs > durationMs) throw new Error("Invalid watched interval");
    return { ...interval };
  }).sort((a, b) => a.startsAtMs - b.startsAtMs || a.endsAtMs - b.endsAtMs);
  const merged: WatchedInterval[] = [];
  for (const interval of sorted) {
    const prior = merged.at(-1);
    if (prior && interval.startsAtMs <= prior.endsAtMs) prior.endsAtMs = Math.max(prior.endsAtMs, interval.endsAtMs);
    else merged.push(interval);
  }
  return merged;
}

function totalWatched(intervals: WatchedInterval[]) {
  return intervals.reduce((total, interval) => total + interval.endsAtMs - interval.startsAtMs, 0);
}

export function advanceReplayProgress(input: {
  intervals: WatchedInterval[];
  durationMs: number;
  previousPlayheadMs: number;
  currentPlayheadMs: number;
  previousObservedAtMs: number;
  observedAtMs: number;
}) {
  const intervals = normalizeWatchedIntervals(input.intervals, input.durationMs);
  const values = [input.previousPlayheadMs, input.currentPlayheadMs, input.previousObservedAtMs, input.observedAtMs];
  if (values.some((value) => !Number.isSafeInteger(value)) || input.previousPlayheadMs < 0 || input.currentPlayheadMs < 0 || input.currentPlayheadMs > input.durationMs || input.observedAtMs <= input.previousObservedAtMs) throw new Error("Invalid replay watch clock");
  const wallDelta = input.observedAtMs - input.previousObservedAtMs;
  const playheadDelta = input.currentPlayheadMs - input.previousPlayheadMs;
  const credible = wallDelta <= MAX_HEARTBEAT_MS && playheadDelta > 0 && playheadDelta <= wallDelta + PLAYHEAD_TOLERANCE_MS;
  const next = credible ? normalizeWatchedIntervals([...intervals, { startsAtMs: input.previousPlayheadMs, endsAtMs: input.currentPlayheadMs }], input.durationMs) : intervals;
  const watchedMs = totalWatched(next);
  return { credited: credible, intervals: next, watchedMs, completed: watchedMs >= input.durationMs };
}
