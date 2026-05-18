// Task #686 — mobile companion to the web's `useTicketsRateLimitGate`.
//
// Background: the API server (Task #675) applies a per-session fixed-
// window rate limit to `GET /api/tickets` and `GET /api/tickets/:id`.
// On trip it returns HTTP 429 with a `Retry-After` header (seconds)
// and a structured JSON body:
//   { code: "tickets.rate_limited", retryAfterSeconds, ... }
// The web client (`artifacts/vndrly`) parks its tickets queries for
// that window and surfaces the existing "reconnecting" pill so users
// see a clear pause indicator instead of a generic toast or, worse,
// a tight retry loop that re-trips the limiter.
//
// The mobile field app uses raw `apiFetch` (no React Query) for its
// ticket-list and ticket-detail calls, so we can't reuse the web hook
// directly. Instead this module provides:
//
//   • `getTicketsRateLimitRetrySeconds(error)` — pure parser that
//     mirrors the web helper. Returns the cooldown seconds when the
//     error is a tickets rate-limit 429, or null otherwise.
//
//   • A module-level cooldown deadline that the React hook below AND
//     the background `liveLocationReporter` share. Both call sites
//     hit the same rate-limit budget on the server, so they should
//     park together — otherwise the reporter would keep polling
//     `/api/tickets` and re-tripping the limit while the foreground
//     screen tries to recover.
//
// The mobile `apiFetch` (lib/api.ts) wraps non-2xx responses as:
//   Error & { status?: number; data?: { code?: string; retryAfterSeconds?: number } }
// — note the absence of a `Headers` object (the response headers are
// dropped during error normalization). So unlike the web hook we
// rely solely on the `data.retryAfterSeconds` field plus a sane
// default. This is intentional: the server guarantees the JSON body
// on every 429, so we don't need the header fallback.

const DEFAULT_RETRY_SECONDS = 10;
const MIN_RETRY_SECONDS = 1;
// Safety clamp — we never want a malformed/abusive response to park
// the screen for hours. 5 minutes mirrors the web cap.
const MAX_RETRY_SECONDS = 5 * 60;

interface ApiErrorLike {
  status?: unknown;
  data?: unknown;
}

function isApiErrorLike(value: unknown): value is ApiErrorLike {
  return Boolean(value) && typeof value === "object";
}

/**
 * Returns the cooldown seconds when `error` is a tickets rate-limit
 * 429 from the server, or `null` for any other error (or no error).
 *
 * Never throws — a missing/garbage `retryAfterSeconds` falls back to
 * `DEFAULT_RETRY_SECONDS`. The result is always clamped to
 * [MIN_RETRY_SECONDS, MAX_RETRY_SECONDS] and rounded up to whole
 * seconds, so callers can use it directly as a setTimeout delay.
 */
export function getTicketsRateLimitRetrySeconds(error: unknown): number | null {
  if (!isApiErrorLike(error)) return null;
  if (error.status !== 429) return null;
  let seconds: number | null = null;
  if (error.data && typeof error.data === "object") {
    const v = (error.data as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) seconds = v;
  }
  if (seconds == null) seconds = DEFAULT_RETRY_SECONDS;
  return Math.min(
    MAX_RETRY_SECONDS,
    Math.max(MIN_RETRY_SECONDS, Math.ceil(seconds)),
  );
}

// ── Shared module-level cooldown ─────────────────────────────────────
// Both the foreground React hook and the background live-location
// reporter consult/update the same deadline. A 429 on either side
// therefore parks both sides for the same window — preventing the
// reporter's 60s `/api/tickets` poll from re-tripping the limiter
// while the user's foreground screen is trying to recover.

type Listener = () => void;

let cooldownUntil: number | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // Listener errors must not break the others; the hook below
      // wraps state setters that don't throw, but stay defensive.
    }
  }
}

/**
 * Subscribe to cooldown changes. Returns an unsubscribe function.
 * The hook uses this so a 429 raised by the background reporter
 * can park the foreground screen too (and vice versa).
 */
export function subscribeTicketsRateLimit(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Returns the active cooldown deadline (`Date.now() + ms`), or null
 * when not currently rate-limited. Auto-clears expired deadlines.
 */
export function getTicketsRateLimitDeadline(
  now: number = Date.now(),
): number | null {
  if (cooldownUntil == null) return null;
  if (cooldownUntil <= now) {
    cooldownUntil = null;
    return null;
  }
  return cooldownUntil;
}

/**
 * Convenience: true while a cooldown is active.
 */
export function isTicketsRateLimited(now: number = Date.now()): boolean {
  return getTicketsRateLimitDeadline(now) != null;
}

/**
 * Inspect `error` and, if it is a tickets rate-limit 429, extend the
 * shared cooldown to cover the server-supplied window. Returns the
 * cooldown seconds when the error was a 429 (so callers can log/
 * surface it), or null for any other error.
 *
 * Never shortens an existing cooldown — if a second 429 lands inside
 * an active window the server is telling us to wait at least that
 * long, but the original deadline may already be later.
 */
export function noteTicketsRateLimit(
  error: unknown,
  now: number = Date.now(),
): number | null {
  const seconds = getTicketsRateLimitRetrySeconds(error);
  if (seconds == null) return null;
  const next = now + seconds * 1000;
  if (cooldownUntil == null || next > cooldownUntil) {
    cooldownUntil = next;
    notify();
  }
  return seconds;
}

/** Test-only: wipe shared state between cases. */
export function __resetTicketsRateLimitForTests(): void {
  cooldownUntil = null;
  listeners.clear();
}
