import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRateLimitRetrySeconds,
  useRateLimitGate,
} from "./use-rate-limit-gate";

// Task #699 — verify the parser + per-resource hook semantics that
// every screen (notifications bell, comments panel, hotlist views)
// depends on. The contract here is load-bearing because:
//
//   • Any code-mismatch bug would let a 429 from /api/comments park
//     the notifications bell (and vice versa), silencing unrelated UI.
//
//   • Any deadline regression would let a query refetch as soon as the
//     gate cleared, immediately re-tripping the limiter.

const NOTIFICATIONS = "notifications.rate_limited";
const COMMENTS = "comments.rate_limited";

function rateLimitError(
  code: string,
  opts: {
    retryAfterSeconds?: unknown;
    headerSeconds?: string | null;
  } = {},
): unknown {
  const data: Record<string, unknown> = { code };
  if (opts.retryAfterSeconds !== undefined) {
    data.retryAfterSeconds = opts.retryAfterSeconds;
  }
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    data,
    headers:
      opts.headerSeconds !== undefined
        ? {
            get: (name: string) =>
              name.toLowerCase() === "retry-after" ? opts.headerSeconds : null,
          }
        : undefined,
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
    // must not park the notifications bell.
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(COMMENTS, { retryAfterSeconds: 5 }),
        NOTIFICATIONS,
      ),
    ).toBeNull();
  });

  it("returns null when the body has no code at all", () => {
    expect(
      getRateLimitRetrySeconds(
        Object.assign(new Error("rate"), { status: 429, data: {} }),
        NOTIFICATIONS,
      ),
    ).toBeNull();
  });

  it("prefers the Retry-After header when both header and body are present", () => {
    // The header is canonical (RFC 9110 §10.2.3). The body field is a
    // convenience fallback for clients that lost the headers.
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(NOTIFICATIONS, {
          retryAfterSeconds: 30,
          headerSeconds: "7",
        }),
        NOTIFICATIONS,
      ),
    ).toBe(7);
  });

  it("falls back to body retryAfterSeconds when no header is present", () => {
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(NOTIFICATIONS, { retryAfterSeconds: 9 }),
        NOTIFICATIONS,
      ),
    ).toBe(9);
  });

  it("falls back to default when both header and body are missing/garbage", () => {
    expect(
      getRateLimitRetrySeconds(rateLimitError(NOTIFICATIONS), NOTIFICATIONS),
    ).toBe(10);
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(NOTIFICATIONS, { retryAfterSeconds: "five" }),
        NOTIFICATIONS,
      ),
    ).toBe(10);
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(NOTIFICATIONS, { retryAfterSeconds: -3 }),
        NOTIFICATIONS,
      ),
    ).toBe(10);
  });

  it("rounds up fractional seconds", () => {
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(NOTIFICATIONS, { retryAfterSeconds: 2.3 }),
        NOTIFICATIONS,
      ),
    ).toBe(3);
  });

  it("clamps absurd values to the safety bounds", () => {
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(NOTIFICATIONS, { retryAfterSeconds: 99999 }),
        NOTIFICATIONS,
      ),
    ).toBe(300);
    expect(
      getRateLimitRetrySeconds(
        rateLimitError(NOTIFICATIONS, { retryAfterSeconds: 0 }),
        NOTIFICATIONS,
      ),
    ).toBe(1);
  });
});

describe("useRateLimitGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns not-rate-limited when no error has been seen", () => {
    const { result } = renderHook(() =>
      useRateLimitGate(null, NOTIFICATIONS),
    );
    expect(result.current.rateLimited).toBe(false);
    expect(result.current.retryAfterSeconds).toBeNull();
  });

  it("arms when a matching 429 fires and reports the cooldown seconds", () => {
    const error = rateLimitError(NOTIFICATIONS, { retryAfterSeconds: 12 });
    const { result } = renderHook(
      ({ err }) => useRateLimitGate(err, NOTIFICATIONS),
      { initialProps: { err: null as unknown } },
    );
    expect(result.current.rateLimited).toBe(false);
    act(() => {
      // re-render with the error
    });
    // Re-render manually with a new error reference.
    const { result: result2 } = renderHook(
      ({ err }) => useRateLimitGate(err, NOTIFICATIONS),
      { initialProps: { err: error } },
    );
    expect(result2.current.rateLimited).toBe(true);
    expect(result2.current.retryAfterSeconds).toBe(12);
  });

  it("ignores 429s whose code does not match the expected code", () => {
    // A comments 429 must NOT park a notifications-coded gate.
    const commentsErr = rateLimitError(COMMENTS, { retryAfterSeconds: 30 });
    const { result } = renderHook(
      ({ err }) => useRateLimitGate(err, NOTIFICATIONS),
      { initialProps: { err: commentsErr } },
    );
    expect(result.current.rateLimited).toBe(false);
    expect(result.current.retryAfterSeconds).toBeNull();
  });

  it("auto-clears when the cooldown window expires", () => {
    const err = rateLimitError(NOTIFICATIONS, { retryAfterSeconds: 5 });
    const { result } = renderHook(() => useRateLimitGate(err, NOTIFICATIONS));
    expect(result.current.rateLimited).toBe(true);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.rateLimited).toBe(false);
    expect(result.current.retryAfterSeconds).toBeNull();
  });

  it("does not shorten an existing cooldown when a smaller 429 lands inside the window", () => {
    const big = rateLimitError(NOTIFICATIONS, { retryAfterSeconds: 60 });
    const small = rateLimitError(NOTIFICATIONS, { retryAfterSeconds: 5 });
    const { result, rerender } = renderHook(
      ({ err }) => useRateLimitGate(err, NOTIFICATIONS),
      { initialProps: { err: big as unknown } },
    );
    expect(result.current.retryAfterSeconds).toBe(60);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    rerender({ err: small });
    // The big window's deadline is 60s from arming = 58s remaining
    // after we advanced 2s; the smaller 5s 429 must not pull the
    // deadline in.
    expect(result.current.retryAfterSeconds).toBe(58);
  });

  it("does not re-arm on the same error reference across renders", () => {
    // react-query keeps the same error object until a fresh fetch — we
    // must not reset the cooldown clock on every re-render.
    const err = rateLimitError(NOTIFICATIONS, { retryAfterSeconds: 30 });
    const { result, rerender } = renderHook(
      ({ err: e }) => useRateLimitGate(e, NOTIFICATIONS),
      { initialProps: { err } },
    );
    expect(result.current.retryAfterSeconds).toBe(30);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender({ err });
    // 20s left, not 30s — the second render must not have re-armed.
    expect(result.current.retryAfterSeconds).toBe(20);
  });
});
