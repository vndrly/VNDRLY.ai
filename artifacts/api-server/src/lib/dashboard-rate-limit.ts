import { createRateLimiter } from "./rate-limit-factory";

// Per-session rate limit on the dashboard read endpoints
// (`GET /api/dashboard/summary`, `GET /api/dashboard/recent-activity`,
// `GET /api/dashboard/ticket-stats`). The dashboard is the landing
// page for every signed-in user and fans out into multiple heavy
// joined reads across `tickets`, `site_locations`, `partners`,
// `vendors`, and `hotlist_jobs/bids` — every page mount fires all
// three endpoints in parallel. A user who leaves the dashboard
// open in many tabs, an integration test that mounts the page in
// a tight loop, or a status-page-style scraper hitting the summary
// endpoint repeatedly could otherwise pin those aggregate queries.
//
// Default budget = 30 req / 10 s, matching tickets — comfortably
// above a realistic page-mount cadence (3 endpoints per mount, a
// handful of mounts per minute on tab focus) but tight enough to
// throttle abuse. Per-role overrides:
// `DASHBOARD_RATE_LIMIT_MAX_<ROLE>` /
// `DASHBOARD_RATE_LIMIT_WINDOW_MS_<ROLE>`, so e.g. admins juggling
// multiple dashboard tabs across monitors can be granted more
// headroom than a vendor.
const limiter = createRateLimiter({
  resourcePrefix: "DASHBOARD",
  errorCode: "dashboard.rate_limited",
  logKind: "dashboard.rate_limit.trip",
  defaultMax: 30,
  defaultWindowMs: 10 * 1000,
  message:
    "Too many dashboard requests in a short window. Please slow down and try again shortly.",
});

export const DASHBOARD_RATE_LIMIT_CONFIG = limiter.CONFIG;
export const getDashboardBudgetForRole = limiter.getBudgetForRole;
export const recordDashboardHit = limiter.recordHit;
export const enforceDashboardRateLimit = limiter.enforce;
export const getDashboardRateLimitKey = limiter.getRateLimitKey;
export const summarizeRecentDashboardTrips = limiter.summarizeRecentTrips;
export const __resetDashboardRateLimitStateForTests =
  limiter.__resetStateForTests;
