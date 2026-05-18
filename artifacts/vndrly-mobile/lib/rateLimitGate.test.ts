import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRateLimitForTests,
  getRateLimitDeadline,
  getRateLimitRetrySeconds,
  isRateLimited,
  noteRateLimit,
  subscribeRateLimit,
} from "./rateLimitGate";

// Task #699 — verify the parser + per-resource shared cooldown
// semantics that every screen-side hook + every background poll
// caller depends on. The contract here is load-bearing because:
//
//   • Any code-mismatch bug would let a 429 from /api/comments park
//     the notifications bell (and vice versa), which would silence
//     unrelated screens.
//
//   • Any deadline regression would let a foreground screen's cooldown
//     diverge from a background poll's, and the background poll would
//     keep re-tripping the limit while the foreground screen waited.
//
//   • Per-resource isolation is the whole point of this generic gate
//     vs. the older single-resource `ticketsRateLimitGate.ts`.

const NOTIFICATIONS = "notifications.rate_limited";
const COMMENTS = "comments.rate_limited";

function rateLimitError(
  code: string,
  retryAfterSeconds?: unknown,
): unknown {
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    data: {
      code,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    },
  });
}

describe("getRateLimitRetrySeconds", () => {
  it("returns null for non-error values", () => {
    expect(getRateLimitRetrySeconds(null, NOTIFICATIONS)).toBeNull();
    expect(getRateLimitRetrySeconds(undefined, NOTIFICATIONS)).toBeNull();
    expect(getRateLimitRetrySeconds("nope", NOTIFICATIONS)).toBeNull();
    expect(getRateLimitRetrySeconds(429, NOTIFICATIONS)).toBeNull();
  });

  it("returns null for non-429 API errors", () => {
    expect(
      getRateLimitRetrySeconds(
        Object.assign(new Error("server"), {
          status: 500,
          data: { code: NOTIFICATIONS },
        }),
        NOTIFICATIONS,
      ),
    ).toBeNull();
  });

  it("returns null when the body code does not match the expected code", () => {
    // The whole point of the per-resource gate: a 429 from comments
    // must NOT park the notifications screen.
    expect(
      getRateLimitRetrySeconds(rateLimitError(COMMENTS, 5), NOTIFICATIONS),
    ).toBeNull();
  });

  it("returns null when the body has no code at all", () => {
    // An untagged 429 is treated as 'not for us' — the matching
    // limiter's gate would still pick it up if/when the server adds
    // a code, but we never park speculatively.
    expect(
      getRateLimitRetrySeconds(
        Object.assign(new Error("rate"), { status: 429, data: {} }),
        NOTIFICATIONS,
      ),
    ).toBeNull();
  });

  it("parses a valid retryAfterSeconds and rounds up", () => {
    expect(
      getRateLimitRetrySeconds(rateLimitError(NOTIFICATIONS, 7), NOTIFICATIONS),
    ).toBe(7);
    expect(
      getRateLimitRetrySeconds(rateLimitError(NOTIFICATIONS, 2.3), NOTIFICATIONS),
    ).toBe(3);
  });

  it("falls back to the default when retryAfterSeconds is missing or garbage", () => {
    // Default is 10s — exercised by missing field and nonsense values.
    expect(
      getRateLimitRetrySeconds(rateLimitError(NOTIFICATIONS), NOTIFICATIONS),
    ).toBe(10);
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(NOTIFICATIONS, "five"),
        NOTIFICATIONS,
      ),
    ).toBe(10);
    expect(
      getRateLimitRetrySeconds(rateLimitError(NOTIFICATIONS, NaN), NOTIFICATIONS),
    ).toBe(10);
    expect(
      getRateLimitRetrySeconds(rateLimitError(NOTIFICATIONS, -3), NOTIFICATIONS),
    ).toBe(10);
  });

  it("clamps absurd values to the safety bounds", () => {
    // 5min cap so a malformed/abusive response can't park the screen
    // indefinitely; sub-second values round up to 1s.
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(NOTIFICATIONS, 99999),
        NOTIFICATIONS,
      ),
    ).toBe(300);
    expect(
      getRateLimitRetrySeconds(rateLimitError(NOTIFICATIONS, 0), NOTIFICATIONS),
    ).toBe(1);
    expect(
      getRateLimitRetrySeconds(rateLimitError(NOTIFICATIONS, 0.1), NOTIFICATIONS),
    ).toBe(1);
  });
});

describe("per-resource shared cooldown", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetRateLimitForTests();
  });

  it("starts not rate-limited", () => {
    expect(isRateLimited(NOTIFICATIONS)).toBe(false);
    expect(getRateLimitDeadline(NOTIFICATIONS)).toBeNull();
  });

  it("noteRateLimit arms the cooldown for the supplied window", () => {
    const seconds = noteRateLimit(
      rateLimitError(NOTIFICATIONS, 15),
      NOTIFICATIONS,
    );
    expect(seconds).toBe(15);
    expect(isRateLimited(NOTIFICATIONS)).toBe(true);
    expect(getRateLimitDeadline(NOTIFICATIONS)).toBe(Date.now() + 15_000);
  });

  it("noteRateLimit is a no-op for non-429 errors", () => {
    const result = noteRateLimit(new Error("network down"), NOTIFICATIONS);
    expect(result).toBeNull();
    expect(isRateLimited(NOTIFICATIONS)).toBe(false);
  });

  it("isolates cooldowns per resource code", () => {
    // The whole point of the generic gate. A 429 from comments must
    // not park the notifications screen even though they share the
    // module-level cache.
    noteRateLimit(rateLimitError(COMMENTS, 30), COMMENTS);
    expect(isRateLimited(COMMENTS)).toBe(true);
    expect(isRateLimited(NOTIFICATIONS)).toBe(false);
    expect(getRateLimitDeadline(NOTIFICATIONS)).toBeNull();
  });

  it("auto-clears once the window expires", () => {
    noteRateLimit(rateLimitError(NOTIFICATIONS, 5), NOTIFICATIONS);
    expect(isRateLimited(NOTIFICATIONS)).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(isRateLimited(NOTIFICATIONS)).toBe(false);
    expect(getRateLimitDeadline(NOTIFICATIONS)).toBeNull();
  });

  it("never shortens an active cooldown", () => {
    noteRateLimit(rateLimitError(NOTIFICATIONS, 60), NOTIFICATIONS);
    const longDeadline = getRateLimitDeadline(NOTIFICATIONS);
    noteRateLimit(rateLimitError(NOTIFICATIONS, 5), NOTIFICATIONS);
    expect(getRateLimitDeadline(NOTIFICATIONS)).toBe(longDeadline);
  });

  it("extends the cooldown when a later 429 pushes past the current deadline", () => {
    noteRateLimit(rateLimitError(NOTIFICATIONS, 5), NOTIFICATIONS);
    const first = getRateLimitDeadline(NOTIFICATIONS)!;
    vi.advanceTimersByTime(2_000);
    noteRateLimit(rateLimitError(NOTIFICATIONS, 10), NOTIFICATIONS);
    const second = getRateLimitDeadline(NOTIFICATIONS)!;
    expect(second).toBeGreaterThan(first);
    expect(second).toBe(Date.now() + 10_000);
  });

  it("notifies subscribers when the cooldown is armed (cross-caller parking)", () => {
    // The hook relies on this so a 429 raised by the background badge
    // poll parks the foreground notifications screen too.
    const listener = vi.fn();
    const unsub = subscribeRateLimit(NOTIFICATIONS, listener);
    noteRateLimit(rateLimitError(NOTIFICATIONS, 8), NOTIFICATIONS);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    noteRateLimit(rateLimitError(NOTIFICATIONS, 120), NOTIFICATIONS);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("only notifies subscribers of the matching resource", () => {
    // A comments 429 must not wake up the notifications subscriber —
    // otherwise we'd cause spurious re-renders / cascade refetches
    // across unrelated screens.
    const notifListener = vi.fn();
    const commentsListener = vi.fn();
    subscribeRateLimit(NOTIFICATIONS, notifListener);
    subscribeRateLimit(COMMENTS, commentsListener);
    noteRateLimit(rateLimitError(COMMENTS, 8), COMMENTS);
    expect(commentsListener).toHaveBeenCalledTimes(1);
    expect(notifListener).not.toHaveBeenCalled();
  });

  it("does not notify when a redundant 429 fails to extend the deadline", () => {
    // Avoid a notification storm from listeners that re-render on every
    // change — the deadline really hasn't moved, so don't churn.
    noteRateLimit(rateLimitError(NOTIFICATIONS, 60), NOTIFICATIONS);
    const listener = vi.fn();
    subscribeRateLimit(NOTIFICATIONS, listener);
    noteRateLimit(rateLimitError(NOTIFICATIONS, 5), NOTIFICATIONS);
    expect(listener).not.toHaveBeenCalled();
  });
});
