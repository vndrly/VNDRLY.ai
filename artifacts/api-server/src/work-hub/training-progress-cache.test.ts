import { afterEach, expect, it, vi } from "vitest";
import { cachedTrainingProgress, invalidateTrainingProgress } from "./training-progress-cache";
afterEach(() => { invalidateTrainingProgress("production:vendor:1"); vi.useRealTimers(); });
const key = "production:vendor:1:7:9";
it("shares in-flight work and reuses fresh summaries", async () => {
  const load = vi.fn(async () => ({ completed: 1 }));
  const results = await Promise.all([cachedTrainingProgress(key, load), cachedTrainingProgress(key, load)]);
  expect(results).toEqual([{ completed: 1 }, { completed: 1 }]);
  await cachedTrainingProgress(key, load);
  expect(load).toHaveBeenCalledTimes(1);
});
it("returns a recent summary immediately while refreshing", async () => {
  vi.useFakeTimers();
  await cachedTrainingProgress(key, async () => 1);
  vi.advanceTimersByTime(16_000);
  let finish!: (n: number) => void;
  expect(await cachedTrainingProgress(key, () => new Promise<number>(resolve => { finish = resolve; }))).toBe(1);
  finish(2);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(await cachedTrainingProgress(key, async () => 3)).toBe(2);
});
it("invalidates immediately and prevents old work from restoring invalidated results", async () => {
  let finish!: (n: number) => void;
  const pending = cachedTrainingProgress(key, () => new Promise<number>(resolve => { finish = resolve; }));
  await Promise.resolve();
  invalidateTrainingProgress("production:vendor:1");
  expect(await cachedTrainingProgress(key, async () => 2)).toBe(2);
  finish(1); await pending;
  expect(await cachedTrainingProgress(key, async () => 3)).toBe(2);
});
it("does not reuse another membership or company summary", async () => {
  await cachedTrainingProgress(key, async () => 1);
  expect(await cachedTrainingProgress("production:vendor:1:7:10", async () => 2)).toBe(2);
  expect(await cachedTrainingProgress("demo:vendor:1:7:9", async () => 3)).toBe(3);
  invalidateTrainingProgress("demo:vendor:1");
});
it("retries failed calculations", async () => {
  await expect(cachedTrainingProgress(key, async () => { throw Error("unavailable"); })).rejects.toThrow("unavailable");
  expect(await cachedTrainingProgress(key, async () => 2)).toBe(2);
});
it("waits for a fresh result rather than serving summaries older than a minute", async () => {
  vi.useFakeTimers();
  await cachedTrainingProgress(key, async () => 1);
  vi.advanceTimersByTime(61_000);
  expect(await cachedTrainingProgress(key, async () => 2)).toBe(2);
});
