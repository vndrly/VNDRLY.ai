import { createRateLimiter } from "./rate-limit-factory";

// Per-session rate limit on the live-locations read endpoints
// (`GET /api/live-locations`, `GET /api/live-locations/events`).
// The fleet map polls the REST endpoint as a fallback and opens
// the SSE channel as the primary feed; both back onto the same
// "latest live_ping per ticket" join across `gps_logs ⋈ tickets ⋈
// field_employees ⋈ site_locations` plus an additional self-join
// to derive a heading bearing from the previous ping. A misbehaving
// client (a stuck reconnect loop on the SSE stream, a fleet-map
// page open in many tabs, a scraper sweeping vendor ids) could
// otherwise hammer that aggregate query continuously.
//
// Default budget = 30 req / 10 s, matching tickets/visits — well
// above the legitimate REST-fallback cadence and the occasional
// reopen of the SSE stream, while still tripping on a tight
// reconnect loop. Per-role overrides:
// `LIVE_LOCATIONS_RATE_LIMIT_MAX_<ROLE>` /
// `LIVE_LOCATIONS_RATE_LIMIT_WINDOW_MS_<ROLE>`, so e.g. admins
// who keep the fleet map open across multiple monitors can be
// granted more headroom than a vendor watching their own crew.
const limiter = createRateLimiter({
  resourcePrefix: "LIVE_LOCATIONS",
  errorCode: "live_locations.rate_limited",
  logKind: "live_locations.rate_limit.trip",
  defaultMax: 30,
  defaultWindowMs: 10 * 1000,
  message:
    "Too many live-location requests in a short window. Please slow down and try again shortly.",
});

export const LIVE_LOCATIONS_RATE_LIMIT_CONFIG = limiter.CONFIG;
export const getLiveLocationsBudgetForRole = limiter.getBudgetForRole;
export const recordLiveLocationsHit = limiter.recordHit;
export const enforceLiveLocationsRateLimit = limiter.enforce;
export const getLiveLocationsRateLimitKey = limiter.getRateLimitKey;
export const summarizeRecentLiveLocationsTrips = limiter.summarizeRecentTrips;
export const __resetLiveLocationsRateLimitStateForTests =
  limiter.__resetStateForTests;
