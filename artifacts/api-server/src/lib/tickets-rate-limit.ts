import { createRateLimiter } from "./rate-limit-factory";

// Per-session (or per-IP fallback) fixed-window rate limit applied to the
// ticket-list and ticket-detail GET endpoints. Task #670 added a
// client-side cooldown on the manual "Refresh now" button so a mashed
// click can't fire dozens of `/api/tickets` requests per second; that's
// the right UX fix, but a misbehaving browser extension, an old client
// without the throttle, a runaway test script, or a buggy future feature
// could still hammer the endpoint and turn excessive polling into a
// database outage.
//
// This is a thin server-side guard rail: each authenticated session (or
// the client IP, if the request is somehow unauthenticated by the time
// it reaches us) gets a budget of `max` reads in `windowMs`. At the
// configured default of 30 req / 10 s = 3 req/s sustained, the normal
// polling + SSE-driven invalidation + manual-refresh cadence has huge
// headroom; the limit only trips on genuine abuse patterns.
//
// Task #687: the limiter consults the authenticated user's role to pick
// a budget, so power users (e.g. dispatchers viewing the live tickets
// board) can be granted more headroom than a vendor checking a single
// ticket without loosening the cap for everyone. Per-role overrides
// come from env vars `TICKETS_RATE_LIMIT_MAX_<ROLE>` and
// `TICKETS_RATE_LIMIT_WINDOW_MS_<ROLE>`; absent overrides fall back to
// the global default (`TICKETS_RATE_LIMIT_MAX` / `..._WINDOW_MS`),
// which itself falls back to 30 / 10s. Unknown or unauthenticated
// callers always get the global default.
//
// Task #700: the limiter delegates its bucket counters to the shared
// `BucketStore` resolved by `rate-limit-factory.ts`, so a multi-replica
// API server enforces an accurate org-wide cap (Redis when configured,
// in-process map otherwise). This file used to maintain its own
// `Map<string, BucketEntry>` independent of the factory; that
// duplication is gone and all behaviour now flows through
// `createRateLimiter`. Public function names are preserved so existing
// callers keep working — they only need to `await` the now-async
// `recordTicketsHit` / `enforceTicketsRateLimit`.

/**
 * Canonical list of session roles the API issues today. Used by the
 * admin operations dashboard (Task #688) to render the resolved
 * `{ max, windowMs }` budget per role so an operator can confirm an
 * env-var override took effect after a restart, without having to
 * read the env directly or wait for a 429.
 *
 * If a future release adds a new role string, append it here so it
 * shows up in the operator readout. Order is the order rendered in
 * the UI; keep `admin` first (most-privileged → least).
 */
export const KNOWN_ROLES = [
  "admin",
  "partner",
  "vendor",
  "field_employee",
  "guest",
] as const;
export type KnownRole = (typeof KNOWN_ROLES)[number];

export type {
  RateBudget,
  RateLimitResult,
  RateLimitTrip,
  RateLimitTripRoleSummary,
  RateLimitTripWindowSummary,
} from "./rate-limit-factory";

const limiter = createRateLimiter({
  resourcePrefix: "TICKETS",
  errorCode: "tickets.rate_limited",
  logKind: "tickets.rate_limit.trip",
  defaultMax: 30,
  defaultWindowMs: 10 * 1000,
  message:
    "Too many ticket requests in a short window. Please slow down and try again shortly.",
});

/**
 * Snapshot of the current default budget. Kept for compatibility with
 * existing callers/tests that read `TICKETS_RATE_LIMIT_CONFIG.max` or
 * `.windowMs`. Per-role budgets must go through
 * `getTicketsBudgetForRole`.
 */
export const TICKETS_RATE_LIMIT_CONFIG = limiter.CONFIG;

/**
 * Resolve the rate-limit budget for a given session role.
 *
 * Unauthenticated callers, and roles whose strings don't match the
 * sanitized role pattern, get the global default budget
 * (`TICKETS_RATE_LIMIT_MAX` / `TICKETS_RATE_LIMIT_WINDOW_MS`, default
 * 30 / 10s). Any role that does match — e.g. `admin`, `vendor`,
 * `partner`, `field_employee`, `dispatcher` — can be tuned
 * independently via `TICKETS_RATE_LIMIT_MAX_<ROLE>` and
 * `TICKETS_RATE_LIMIT_WINDOW_MS_<ROLE>` (uppercased role name).
 * Roles that pass the pattern but have no override env set still
 * receive the global default, so adding an override is purely
 * additive — no role's budget changes until an operator sets one.
 */
export const getTicketsBudgetForRole = limiter.getBudgetForRole;

/**
 * Record a hit for `key` and report whether the request is allowed.
 * Fixed-window: each key gets `budget.max` calls within
 * `budget.windowMs`, then resets at the next window boundary. Defaults
 * to the global (role-less) budget so callers that don't yet have a
 * role keep working unchanged. Async because the underlying
 * `BucketStore` may be Redis-backed.
 */
export const recordTicketsHit = limiter.recordHit;

/**
 * Build a stable rate-limit key for the request. Prefer the session
 * userId (so two browsers on the same NAT don't share a budget); fall
 * back to the client IP for the rare case where a request reaches the
 * route without a decoded session (the route handler will reject it
 * with 401 right after, but we still want abuse signals from those
 * attempts to count against *something*).
 */
export const getTicketsRateLimitKey = limiter.getRateLimitKey;

/**
 * Apply the limiter to a tickets-route response. On trip, writes 429
 * with `Retry-After` (seconds, per RFC 9110 §10.2.3) plus a structured
 * JSON body the web/mobile clients can branch on, and resolves to
 * `false` so the caller can early-return. On allow, resolves to `true`
 * and lets the handler proceed.
 */
export const enforceTicketsRateLimit = limiter.enforce;

/**
 * Snapshot of every retained 429 trip captured by the tickets
 * limiter on this replica (Task #696). Optionally filter by
 * `sinceMs` to scope to a window the operator cares about (the
 * dashboard panel uses 60 min and 24 h). Backed by an in-process
 * ring buffer that survives only as long as the API process is
 * up — the durable record is the structured `tickets.rate_limit.trip`
 * log line.
 */
export const getRecentTicketsTrips = limiter.getRecentTrips;

/**
 * Aggregate the recent-trips ring buffer into a per-role summary
 * for one window (Task #696). Used by the admin operations
 * dashboard so the displayed counts come from the same limiter
 * that `getTicketsBudgetForRole` reports — the panel can never
 * show counts for a role whose budget the budgets card doesn't.
 */
export const summarizeRecentTicketsTrips = limiter.summarizeRecentTrips;

/**
 * Tuning knobs and current size of the in-process trips buffer.
 * Surfaced to the admin endpoint so an operator can tell at a
 * glance whether the buffer was full when they looked (i.e.
 * "trips happened before this entry but were evicted").
 */
export const getTicketsTripsBufferInfo = limiter.getTripsBufferInfo;

/** Test-only helper to wipe in-memory state between cases. */
export const __resetTicketsRateLimitStateForTests = limiter.__resetStateForTests;
