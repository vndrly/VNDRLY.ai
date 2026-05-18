import { createRateLimiter } from "./rate-limit-factory";

// Per-session rate limit on the staff-facing visit read endpoints
// (`GET /api/visits`, `GET /api/visits/:id`, `GET /api/visits/events`).
// The web visitor list and the mobile field app both poll
// `/api/visits` on a 30 second `refetchInterval`, and the SSE
// channel at `/api/visits/events` invalidates that list on every
// check-in / check-out, so a single session can comfortably exceed
// 1 req/s during an active shift even before any client bug. A
// stuck refetch loop, an extension that re-mounts the visitor list
// on every DOM mutation, or a runaway integration test could
// otherwise turn that polling into hundreds of joined reads per
// second against `site_visits ⋈ site_locations ⋈ partners ⋈ vendors`.
//
// Default budget = 30 req / 10 s, matching tickets/comments — well
// above the legitimate 30 s polling cadence + SSE-driven
// invalidations with headroom for tab focus refreshes, while still
// tripping on a tight loop. Per-role overrides:
// `VISITS_RATE_LIMIT_MAX_<ROLE>` /
// `VISITS_RATE_LIMIT_WINDOW_MS_<ROLE>`, so e.g. dispatchers
// monitoring many sites can be granted more headroom than a vendor
// glancing at their own visits.
const limiter = createRateLimiter({
  resourcePrefix: "VISITS",
  errorCode: "visits.rate_limited",
  logKind: "visits.rate_limit.trip",
  defaultMax: 30,
  defaultWindowMs: 10 * 1000,
  message:
    "Too many visit requests in a short window. Please slow down and try again shortly.",
});

export const VISITS_RATE_LIMIT_CONFIG = limiter.CONFIG;
export const getVisitsBudgetForRole = limiter.getBudgetForRole;
export const recordVisitsHit = limiter.recordHit;
export const enforceVisitsRateLimit = limiter.enforce;
export const getVisitsRateLimitKey = limiter.getRateLimitKey;
export const summarizeRecentVisitsTrips = limiter.summarizeRecentTrips;
export const __resetVisitsRateLimitStateForTests =
  limiter.__resetStateForTests;
