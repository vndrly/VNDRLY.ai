import { useEffect, useRef, useState } from "react";

// Task #675 — shared client-side companion to the per-session rate
// limit on `/api/tickets` and `/api/tickets/:id`. The server returns
// HTTP 429 with a `Retry-After` header (seconds) and a structured
// `{ code: "tickets.rate_limited", retryAfterSeconds, … }` body once a
// single session exceeds its budget. Without this hook every page
// hitting the limit would react-query-retry into the wall and fire a
// generic "Action failed" toast — not informative, and it works against
// the whole point of the limiter (give the database breathing room).
//
// What this hook does:
//   • Detects the 429 from the latest query error (either the
//     `Retry-After` header or `retryAfterSeconds` in the JSON body —
//     header wins when both are present).
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
// We intentionally key off the query's *error* object (not a global
// fetch interceptor) so the cooldown is scoped to the page that
// actually got rate-limited. Other pages on the same session that
// happen to call /api/tickets will see their own 429 and gate
// themselves the same way.

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
 * Returns the cooldown seconds when `error` is a tickets rate-limit
 * 429 from the server, or `null` for any other error (or no error).
 * Never throws — a malformed Retry-After value just falls back to the
 * structured `retryAfterSeconds` field, then to `DEFAULT_RETRY_SECONDS`.
 */
export function getTicketsRateLimitRetrySeconds(error: unknown): number | null {
  if (!isApiErrorLike(error)) return null;
  if (error.status !== 429) return null;
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
    error.data &&
    typeof error.data === "object" &&
    "retryAfterSeconds" in error.data
  ) {
    const v = (error.data as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) seconds = v;
  }
  if (seconds == null) seconds = DEFAULT_RETRY_SECONDS;
  return Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, Math.ceil(seconds)));
}

export interface TicketsRateLimitGate {
  /**
   * True while the page is parked. Pass to `enabled` on the affected
   * useQuery hooks and gate any SSE-driven invalidations / manual
   * refresh handlers on this so we don't immediately re-trip the limit.
   */
  rateLimited: boolean;
}

/**
 * Watches a query's `error` for tickets rate-limit 429s and parks the
 * page for the indicated cooldown. Pages should additionally surface
 * their existing "reconnecting" pill while `rateLimited` is true so
 * users see a familiar pause indicator instead of a silent gap.
 */
export function useTicketsRateLimitGate(error: unknown): TicketsRateLimitGate {
  const [until, setUntil] = useState<number | null>(null);
  // Track the last error reference we processed so we don't re-arm on
  // every render — react-query keeps the same error object across
  // renders until a fresh fetch produces a new one.
  const lastErrorRef = useRef<unknown>(null);

  useEffect(() => {
    if (error === lastErrorRef.current) return;
    lastErrorRef.current = error;
    const seconds = getTicketsRateLimitRetrySeconds(error);
    if (seconds == null) return;
    const next = Date.now() + seconds * 1000;
    // Don't shorten an existing cooldown — if a second 429 arrives in
    // the same window the server is telling us to wait at least that
    // long, but the original deadline may already be later.
    setUntil((prev) => (prev != null && prev > next ? prev : next));
  }, [error]);

  useEffect(() => {
    if (until == null) return;
    const ms = until - Date.now();
    if (ms <= 0) {
      setUntil(null);
      return;
    }
    const timer = setTimeout(() => setUntil((prev) => (prev === until ? null : prev)), ms);
    return () => clearTimeout(timer);
  }, [until]);

  return { rateLimited: until != null && until > Date.now() };
}

export default useTicketsRateLimitGate;
