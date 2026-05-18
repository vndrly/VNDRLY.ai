// Task #699 — generic per-resource rate-limit gate for the mobile app.
//
// Mirrors the existing `lib/ticketsRateLimitGate.ts` (Task #686) but is
// scoped per server-side `code` (e.g. "notifications.rate_limited",
// "comments.rate_limited"). The server-side rate-limit factory
// (artifacts/api-server/src/lib/rate-limit-factory.ts) attaches a stable
// `code` to every 429 JSON body so each resource's cooldown is isolated.
//
// Why per-resource rather than one shared cooldown?
//   • The notifications bell, the comments panel, and the hotlist screen
//     each hit different limiters on the server. A 429 from comments
//     must NOT park the notifications poll, otherwise a noisy chat
//     thread would silence the bell entirely.
//   • Within a single resource we DO want shared state: e.g. if both
//     `app/notifications.tsx` (foreground list) and `app/(tabs)/index.tsx`
//     (badge poll) trip the notifications limiter, both should park
//     together — otherwise the badge would keep polling and re-tripping
//     the limit while the foreground list was waiting.
//
// The mobile `apiFetch` (lib/api.ts) wraps non-2xx responses as:
//   Error & { status?: number; data?: { code?: string; retryAfterSeconds?: number } }
// — note the absence of a `Headers` object (response headers are dropped
// during error normalization). So unlike the web hook we rely solely on
// the `data.retryAfterSeconds` field plus a sane default. This is
// intentional: the server guarantees the JSON body on every 429.

const DEFAULT_RETRY_SECONDS = 10;
const MIN_RETRY_SECONDS = 1;
// Safety clamp — never park the screen for hours on a malformed
// response. 5 minutes mirrors the web cap.
const MAX_RETRY_SECONDS = 5 * 60;

interface ApiErrorLike {
  status?: unknown;
  data?: unknown;
}

function isApiErrorLike(value: unknown): value is ApiErrorLike {
  return Boolean(value) && typeof value === "object";
}

/**
 * Returns the cooldown seconds when `error` is a 429 from the server
 * whose `data.code` matches `expectedCode`, or `null` for any other
 * error (or no error). Never throws — a missing/garbage
 * `retryAfterSeconds` falls back to `DEFAULT_RETRY_SECONDS`. The result
 * is always clamped to [MIN_RETRY_SECONDS, MAX_RETRY_SECONDS] and
 * rounded up to whole seconds, so callers can use it directly as a
 * setTimeout delay.
 */
export function getRateLimitRetrySeconds(
  error: unknown,
  expectedCode: string,
): number | null {
  if (!isApiErrorLike(error)) return null;
  if (error.status !== 429) return null;
  const data = (error.data ?? null) as
    | { code?: unknown; retryAfterSeconds?: unknown }
    | null;
  if (!data || typeof data.code !== "string" || data.code !== expectedCode) {
    return null;
  }
  let seconds: number | null = null;
  if (
    typeof data.retryAfterSeconds === "number" &&
    Number.isFinite(data.retryAfterSeconds) &&
    data.retryAfterSeconds >= 0
  ) {
    seconds = data.retryAfterSeconds;
  }
  if (seconds == null) seconds = DEFAULT_RETRY_SECONDS;
  return Math.min(
    MAX_RETRY_SECONDS,
    Math.max(MIN_RETRY_SECONDS, Math.ceil(seconds)),
  );
}

// ── Per-resource shared cooldowns ────────────────────────────────────
// Each resource code (e.g. "notifications.rate_limited") gets its own
// isolated cooldown deadline + listener set. Multiple call sites
// (foreground screen + background poll) for the same resource share
// state via the code; different resources never park each other.

type Listener = () => void;

interface ResourceState {
  cooldownUntil: number | null;
  listeners: Set<Listener>;
}

const resources = new Map<string, ResourceState>();

function getResource(code: string): ResourceState {
  let r = resources.get(code);
  if (!r) {
    r = { cooldownUntil: null, listeners: new Set() };
    resources.set(code, r);
  }
  return r;
}

function notify(r: ResourceState): void {
  for (const l of r.listeners) {
    try {
      l();
    } catch {
      // Defensive: a buggy listener must not break the others. The
      // hook below wraps state setters that don't throw, but other
      // future call sites might.
    }
  }
}

/**
 * Subscribe to cooldown changes for `code`. Returns an unsubscribe
 * function. The hook uses this so a 429 raised by another caller for
 * the same resource (e.g. background badge poll vs. foreground list)
 * parks every screen on that resource together.
 */
export function subscribeRateLimit(
  code: string,
  listener: Listener,
): () => void {
  const r = getResource(code);
  r.listeners.add(listener);
  return () => {
    r.listeners.delete(listener);
  };
}

/**
 * Returns the active cooldown deadline (`Date.now() + ms`) for `code`,
 * or null when not currently rate-limited. Auto-clears expired
 * deadlines on read.
 */
export function getRateLimitDeadline(
  code: string,
  now: number = Date.now(),
): number | null {
  const r = getResource(code);
  if (r.cooldownUntil == null) return null;
  if (r.cooldownUntil <= now) {
    r.cooldownUntil = null;
    return null;
  }
  return r.cooldownUntil;
}

/**
 * Convenience: true while a cooldown is active for `code`.
 */
export function isRateLimited(
  code: string,
  now: number = Date.now(),
): boolean {
  return getRateLimitDeadline(code, now) != null;
}

/**
 * Inspect `error` and, if it is a `code`-matched rate-limit 429, extend
 * that resource's cooldown to cover the server-supplied window. Returns
 * the cooldown seconds when the error matched (so callers can log /
 * surface it), or null otherwise.
 *
 * Never shortens an existing cooldown — if a second 429 lands inside
 * an active window the server is telling us to wait at least that
 * long, but the original deadline may already be later.
 */
export function noteRateLimit(
  error: unknown,
  expectedCode: string,
  now: number = Date.now(),
): number | null {
  const seconds = getRateLimitRetrySeconds(error, expectedCode);
  if (seconds == null) return null;
  const r = getResource(expectedCode);
  const next = now + seconds * 1000;
  if (r.cooldownUntil == null || next > r.cooldownUntil) {
    r.cooldownUntil = next;
    notify(r);
  }
  return seconds;
}

/** Test-only: wipe shared state between cases. */
export function __resetRateLimitForTests(): void {
  resources.clear();
}
