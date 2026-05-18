import { createRateLimiter } from "./rate-limit-factory";

// Per-session rate limit on the hotlist read endpoints
// (`/api/hotlist/jobs`, `/api/hotlist/jobs/:id`). The list is the
// vendor "open jobs" feed and the partner "my postings" board; the
// detail view is opened repeatedly while bidders refresh to see new
// bids and award decisions. Bid mutations invalidate
// `["hotlist", "list", …]` and `["hotlist", "job", id]` queries,
// which in an active job can fire in quick succession. Without a
// limiter a single misbehaving client (a stuck refresh interval, a
// scraper sweeping job ids, a runaway test) could overwhelm the
// joined queries that back these endpoints.
//
// Default budget = 30 req / 10 s, matching tickets — comfortably
// above the normal mutation-driven invalidation cadence, but tight
// enough to throttle abuse. Per-role overrides:
// `HOTLIST_RATE_LIMIT_MAX_<ROLE>` /
// `HOTLIST_RATE_LIMIT_WINDOW_MS_<ROLE>`, so e.g. partners managing
// many concurrent jobs can be granted more headroom than a vendor
// passively browsing.
const limiter = createRateLimiter({
  resourcePrefix: "HOTLIST",
  errorCode: "hotlist.rate_limited",
  logKind: "hotlist.rate_limit.trip",
  defaultMax: 30,
  defaultWindowMs: 10 * 1000,
  message:
    "Too many hotlist requests in a short window. Please slow down and try again shortly.",
});

export const HOTLIST_RATE_LIMIT_CONFIG = limiter.CONFIG;
export const getHotlistBudgetForRole = limiter.getBudgetForRole;
export const recordHotlistHit = limiter.recordHit;
export const enforceHotlistRateLimit = limiter.enforce;
export const getHotlistRateLimitKey = limiter.getRateLimitKey;
export const summarizeRecentHotlistTrips = limiter.summarizeRecentTrips;
export const __resetHotlistRateLimitStateForTests =
  limiter.__resetStateForTests;
