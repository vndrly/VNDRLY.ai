import { describe, expect, it } from "vitest";
import { advanceReplayProgress, normalizeWatchedIntervals } from "./meeting-replay-progress";

describe("meeting replay watched progress", () => {
  it("credits only continuous playhead time supported by elapsed server time", () => {
    const first = advanceReplayProgress({
      intervals: [],
      durationMs: 60_000,
      previousPlayheadMs: 0,
      currentPlayheadMs: 5_000,
      previousObservedAtMs: 10_000,
      observedAtMs: 15_000,
    });
    expect(first).toMatchObject({ credited: true, watchedMs: 5_000, completed: false });
    expect(first.intervals).toEqual([{ startsAtMs: 0, endsAtMs: 5_000 }]);

    const skipped = advanceReplayProgress({
      intervals: first.intervals,
      durationMs: 60_000,
      previousPlayheadMs: 5_000,
      currentPlayheadMs: 55_000,
      previousObservedAtMs: 15_000,
      observedAtMs: 16_000,
    });
    expect(skipped).toMatchObject({ credited: false, watchedMs: 5_000, completed: false });
    expect(skipped.intervals).toEqual(first.intervals);
  });

  it("merges repeated and adjacent watched windows without double credit", () => {
    expect(normalizeWatchedIntervals([
      { startsAtMs: 5_000, endsAtMs: 10_000 },
      { startsAtMs: 0, endsAtMs: 6_000 },
      { startsAtMs: 10_000, endsAtMs: 12_000 },
    ], 20_000)).toEqual([{ startsAtMs: 0, endsAtMs: 12_000 }]);
  });

  it("requires full timeline coverage before marking a required replay complete", () => {
    const result = advanceReplayProgress({
      intervals: [{ startsAtMs: 0, endsAtMs: 55_000 }],
      durationMs: 60_000,
      previousPlayheadMs: 55_000,
      currentPlayheadMs: 60_000,
      previousObservedAtMs: 100_000,
      observedAtMs: 105_000,
    });
    expect(result).toMatchObject({ credited: true, watchedMs: 60_000, completed: true });
  });

  it("fails closed for reversed clocks, rewinds, oversized heartbeats, and invalid intervals", () => {
    const base = {
      intervals: [], durationMs: 60_000, previousPlayheadMs: 10_000,
      currentPlayheadMs: 11_000, previousObservedAtMs: 20_000, observedAtMs: 21_000,
    };
    expect(() => advanceReplayProgress({ ...base, observedAtMs: 19_000 })).toThrow("Invalid replay watch clock");
    expect(advanceReplayProgress({ ...base, currentPlayheadMs: 9_000 }).credited).toBe(false);
    expect(advanceReplayProgress({ ...base, observedAtMs: 60_001 }).credited).toBe(false);
    expect(() => normalizeWatchedIntervals([{ startsAtMs: -1, endsAtMs: 5 }], 60_000)).toThrow("Invalid watched interval");
  });
});
