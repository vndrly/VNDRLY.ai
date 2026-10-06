import { afterEach, describe, expect, it, vi } from "vitest";
import { withRequestDeadline } from "./request-deadline";

afterEach(() => vi.useRealTimers());
describe("request deadlines", () => {
  it("returns successful work and clears its timer", async () => {
    vi.useFakeTimers();
    expect(await withRequestDeadline(async () => "saved", { timeoutMs: 30, timeoutMessage: "unverified" })).toBe("saved");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("settles an ignored abort and never retries an uncertain write", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const run = vi.fn((value: AbortSignal) => { signal = value; return new Promise<never>(() => {}); });
    const result = withRequestDeadline(run, { timeoutMs: 30, timeoutMessage: "result unverified" });
    const assertion = expect(result).rejects.toThrow("result unverified");
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves caller cancellation without starting an already-cancelled request", async () => {
    const caller = new AbortController();
    caller.abort(new Error("caller cancelled"));
    const run = vi.fn();
    await expect(withRequestDeadline(run, { signal: caller.signal, timeoutMs: 30, timeoutMessage: "timeout" })).rejects.toThrow("caller cancelled");
    expect(run).not.toHaveBeenCalled();
  });
  it("aborts pending work on caller cancellation and clears its timer", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let signal: AbortSignal | undefined;
    const result = withRequestDeadline(value => { signal = value; return new Promise<never>(() => {}); }, { signal: caller.signal, timeoutMs: 30, timeoutMessage: "timeout" });
    const assertion = expect(result).rejects.toThrow("caller cancelled");
    await Promise.resolve();
    caller.abort(new Error("caller cancelled"));
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
