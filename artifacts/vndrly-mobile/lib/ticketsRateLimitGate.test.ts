import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetTicketsRateLimitForTests,
  getTicketsRateLimitDeadline,
  getTicketsRateLimitRetrySeconds,
  isTicketsRateLimited,
  noteTicketsRateLimit,
  subscribeTicketsRateLimit,
} from "./ticketsRateLimitGate";

// Task #686 — verify the parser + shared cooldown semantics that the
// foreground React hook AND the background live-location reporter
// both depend on. If these diverge the two callers can fight (one
// keeps polling while the other parks), so the contract here is
// load-bearing.

function rateLimitError(retryAfterSeconds?: unknown): unknown {
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    data: {
      code: "tickets.rate_limited",
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    },
  });
}

describe("getTicketsRateLimitRetrySeconds", () => {
  it("returns null for non-error values", () => {
    expect(getTicketsRateLimitRetrySeconds(null)).toBeNull();
    expect(getTicketsRateLimitRetrySeconds(undefined)).toBeNull();
    expect(getTicketsRateLimitRetrySeconds("nope")).toBeNull();
    expect(getTicketsRateLimitRetrySeconds(429)).toBeNull();
  });

  it("returns null for non-429 API errors", () => {
    expect(
      getTicketsRateLimitRetrySeconds(
        Object.assign(new Error("server"), { status: 500 }),
      ),
    ).toBeNull();
    expect(
      getTicketsRateLimitRetrySeconds(
        Object.assign(new Error("auth"), { status: 401 }),
      ),
    ).toBeNull();
  });

  it("parses a valid retryAfterSeconds and rounds up", () => {
    expect(getTicketsRateLimitRetrySeconds(rateLimitError(7))).toBe(7);
    expect(getTicketsRateLimitRetrySeconds(rateLimitError(2.3))).toBe(3);
  });

  it("falls back to the default when retryAfterSeconds is missing or garbage", () => {
    // Default is 10s — exercised by missing field and nonsense values.
    expect(getTicketsRateLimitRetrySeconds(rateLimitError())).toBe(10);
    expect(getTicketsRateLimitRetrySeconds(rateLimitError("five"))).toBe(10);
    expect(getTicketsRateLimitRetrySeconds(rateLimitError(NaN))).toBe(10);
    expect(getTicketsRateLimitRetrySeconds(rateLimitError(-3))).toBe(10);
  });

  it("clamps absurd values to the safety bounds", () => {
    // 5min cap mirrors the web hook so a malformed/abusive response
    // can't park the screen indefinitely.
    expect(getTicketsRateLimitRetrySeconds(rateLimitError(99999))).toBe(300);
    // Anything <1s rounds up to 1s so callers can use it as a delay.
    expect(getTicketsRateLimitRetrySeconds(rateLimitError(0))).toBe(1);
    expect(getTicketsRateLimitRetrySeconds(rateLimitError(0.1))).toBe(1);
  });
});

describe("shared cooldown", () => {
  beforeEach(() => {
    __resetTicketsRateLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetTicketsRateLimitForTests();
  });

  it("starts not rate-limited", () => {
    expect(isTicketsRateLimited()).toBe(false);
    expect(getTicketsRateLimitDeadline()).toBeNull();
  });

  it("noteTicketsRateLimit arms the cooldown for the supplied window", () => {
    const seconds = noteTicketsRateLimit(rateLimitError(15));
    expect(seconds).toBe(15);
    expect(isTicketsRateLimited()).toBe(true);
    expect(getTicketsRateLimitDeadline()).toBe(Date.now() + 15_000);
  });

  it("noteTicketsRateLimit is a no-op for non-429 errors", () => {
    const result = noteTicketsRateLimit(new Error("network down"));
    expect(result).toBeNull();
    expect(isTicketsRateLimited()).toBe(false);
  });

  it("auto-clears once the window expires", () => {
    noteTicketsRateLimit(rateLimitError(5));
    expect(isTicketsRateLimited()).toBe(true);
    vi.advanceTimersByTime(5_000);
    // getTicketsRateLimitDeadline lazily clears at/after the deadline.
    expect(isTicketsRateLimited()).toBe(false);
    expect(getTicketsRateLimitDeadline()).toBeNull();
  });

  it("never shortens an active cooldown", () => {
    noteTicketsRateLimit(rateLimitError(60));
    const longDeadline = getTicketsRateLimitDeadline();
    // A second 429 with a smaller window must not pull the deadline in.
    noteTicketsRateLimit(rateLimitError(5));
    expect(getTicketsRateLimitDeadline()).toBe(longDeadline);
  });

  it("extends the cooldown when a later 429 pushes past the current deadline", () => {
    noteTicketsRateLimit(rateLimitError(5));
    const first = getTicketsRateLimitDeadline()!;
    vi.advanceTimersByTime(2_000);
    noteTicketsRateLimit(rateLimitError(10));
    const second = getTicketsRateLimitDeadline()!;
    expect(second).toBeGreaterThan(first);
    expect(second).toBe(Date.now() + 10_000);
  });

  it("notifies subscribers when the cooldown is armed (cross-caller parking)", () => {
    // This is the contract the React hook relies on so a 429 raised
    // by the background reporter parks the foreground screen too.
    const listener = vi.fn();
    const unsub = subscribeTicketsRateLimit(listener);
    noteTicketsRateLimit(rateLimitError(8));
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    noteTicketsRateLimit(rateLimitError(120));
    // After unsubscribe the listener must not be called again.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when a redundant 429 fails to extend the deadline", () => {
    // Avoid a notification storm from listeners that re-render on every
    // change — the deadline really hasn't moved, so don't churn.
    noteTicketsRateLimit(rateLimitError(60));
    const listener = vi.fn();
    subscribeTicketsRateLimit(listener);
    noteTicketsRateLimit(rateLimitError(5));
    expect(listener).not.toHaveBeenCalled();
  });
});
