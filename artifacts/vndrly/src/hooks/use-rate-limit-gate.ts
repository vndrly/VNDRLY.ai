import { useEffect, useRef, useState } from "react";

// Task #699 — generic per-resource rate-limit gate. Mirrors the existing
// `use-tickets-rate-limit-gate.ts` (Task #675) but scopes each gate
// instance to a specific server-side `code` (e.g. "notifications.rate_limited",
// "comments.rate_limited", "hotlist.rate_limited") so a 429 raised by
// /api/comments doesn't accidentally park the notifications bell, and
// vice versa. The server-side rate-limit factory (artifacts/api-server/
// src/lib/rate-limit-factory.ts) attaches a stable `code` to every 429
// JSON body for exactly this reason.
//
// What this hook does:
//   • Detects the 429 with a matching `code` from the latest query
//     error (either the `Retry-After` header or `retryAfterSeconds` in
//     the JSON body — header wins when both are present).
//   • Parks the page into a cooldown state for that many seconds. While
//     the cooldown is active:
//       – `rateLimited` is true so the calling page can pass
//         `enabled: !rateLimited` to its useQuery hooks (and skip any
//         SSE-driven cache invalidations) so we don't immediately
//         refetch into the same 429.
//       – The hook caller surfaces the existing "reconnecting" pill,
//         giving users the same affordance they already recognize from
//         a dropped SSE connection.
//   • Auto-clears at the end of the window. The query becomes enabled
//     again and react-query refetches once on its own.
//   • If a fresh 429 lands while we're already cooling down, we extend
//     the cooldown to whichever is later (don't shorten an existing
//     window — the server may have moved its boundary).
//
// We require the caller to pass the expected `code` so two unrelated
// pages on the same screen (e.g. the notifications bell + the comments
// panel) park independently. A 429 with a different code is treated
// as "not for us" and ignored — the matching page's gate will handle
// it.

const DEFAULT_RETRY_SECONDS = 10;
const MIN_RETRY_SECONDS = 1;
const MAX_RETRY_SECONDS = 5 * 60; // safety clamp — never park longer than 5 min

interface ApiErrorLike {
  status?: number;
  headers?: { get?: (name: string) => string | null };
  data?: unknown;
}

function isApiErrorLike(value: unknown): value is ApiErrorLike {
  return Boolean(value) && typeof value === "object";
}

/**
 * Returns the cooldown seconds when `error` is a 429 from the server
 * whose `data.code` matches `expectedCode`, or `null` for any other
 * error (or no error). Never throws — a malformed Retry-After value
 * just falls back to the structured `retryAfterSeconds` field, then
 * to `DEFAULT_RETRY_SECONDS`.
 *
 * Exported for unit-testing without rendering a component.
 */
export function getRateLimitRetrySeconds(
  error: unknown,
  expectedCode: string,
): number | null {
  if (!isApiErrorLike(error)) return null;
  if (error.status !== 429) return null;
  // Code match is required — a 429 from a different limiter on the
  // same page must NOT park us. The server attaches `code` to every
  // 429 body via the rate-limit factory, so we treat a missing code
  // as "not the limiter we care about" and ignore it.
  const data = (error.data ?? null) as { code?: unknown; retryAfterSeconds?: unknown } | null;
  if (!data || typeof data.code !== "string" || data.code !== expectedCode) {
    return null;
  }
  // Header is canonical (RFC 9110 §10.2.3, integer seconds). Some
  // proxies normalize header casing; `Headers.get` is case-insensitive
  // but defensive callers may have stripped the Headers wrapper, so we
  // also accept the data field below.
  let seconds: number | null = null;
  const headerValue =
    typeof error.headers?.get === "function"
      ? error.headers.get("retry-after")
      : null;
  if (headerValue) {
    const n = Number(headerValue);
    if (Number.isFinite(n) && n >= 0) seconds = n;
  }
  if (
    seconds == null &&
    typeof data.retryAfterSeconds === "number" &&
    Number.isFinite(data.retryAfterSeconds) &&
    data.retryAfterSeconds >= 0
  ) {
    seconds = data.retryAfterSeconds;
  }
  if (seconds == null) seconds = DEFAULT_RETRY_SECONDS;
  return Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, Math.ceil(seconds)));
}

export interface RateLimitGate {
  /**
   * True while the page is parked. Pass to `enabled` on the affected
   * useQuery hooks and gate any SSE-driven invalidations / manual
   * refresh handlers on this so we don't immediately re-trip the limit.
   */
  rateLimited: boolean;
  /**
   * Seconds remaining in the current cooldown window (rounded up), or
   * `null` when not rate-limited. Useful for friendly "retrying in
   * {{seconds}}s" copy.
   */
  retryAfterSeconds: number | null;
}

/**
 * Watches a query's `error` for rate-limit 429s whose `code` matches
 * `expectedCode` and parks the page for the indicated cooldown. Pages
 * should additionally surface their existing "reconnecting" pill while
 * `rateLimited` is true so users see a familiar pause indicator
 * instead of a silent gap or a scary error toast.
 */
export function useRateLimitGate(
  error: unknown,
  expectedCode: string,
): RateLimitGate {
  const [until, setUntil] = useState<number | null>(null);
  // Track the last error reference we processed so we don't re-arm on
  // every render — react-query keeps the same error object across
  // renders until a fresh fetch produces a new one.
  const lastErrorRef = useRef<unknown>(null);

  useEffect(() => {
    if (error === lastErrorRef.current) return;
    lastErrorRef.current = error;
    const seconds = getRateLimitRetrySeconds(error, expectedCode);
    if (seconds == null) return;
    const next = Date.now() + seconds * 1000;
    // Don't shorten an existing cooldown — if a second 429 arrives in
    // the same window the server is telling us to wait at least that
    // long, but the original deadline may already be later.
    setUntil((prev) => (prev != null && prev > next ? prev : next));
  }, [error, expectedCode]);

  useEffect(() => {
    if (until == null) return;
    const ms = until - Date.now();
    if (ms <= 0) {
      setUntil(null);
      return;
    }
    const timer = setTimeout(
      () => setUntil((prev) => (prev === until ? null : prev)),
      ms,
    );
    return () => clearTimeout(timer);
  }, [until]);

  const now = Date.now();
  const rateLimited = until != null && until > now;
  const retryAfterSeconds = rateLimited
    ? Math.max(1, Math.ceil((until! - now) / 1000))
    : null;
  return { rateLimited, retryAfterSeconds };
}

export default useRateLimitGate;
