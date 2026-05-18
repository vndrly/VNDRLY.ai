import { createRateLimiter } from "./rate-limit-factory";

// Per-session rate limit on the notification bell endpoints
// (`/api/notifications`, `/api/notifications/unread-count`). The web
// notifications bell polls `unreadCount` every 30s on every page,
// across every signed-in tab; mobile fans this out across crew
// devices. A buggy client (background tab stuck in an effect loop, an
// extension that re-mounts the bell on every DOM mutation, a runaway
// integration test) could otherwise turn that polling into hundreds
// of reads per second and pin the notifications table.
//
// Default budget = 30 req / 10 s, identical to tickets — well above
// the legitimate 1 unread-count + 1 list every 30s cadence with
// huge headroom for category tab switching, while still tripping on
// a tight loop. Operators can tune per role via
// `NOTIFICATIONS_RATE_LIMIT_MAX_<ROLE>` /
// `NOTIFICATIONS_RATE_LIMIT_WINDOW_MS_<ROLE>` (e.g. dispatchers who
// keep the bell open through long shifts may justifiably need more).
const limiter = createRateLimiter({
  resourcePrefix: "NOTIFICATIONS",
  errorCode: "notifications.rate_limited",
  logKind: "notifications.rate_limit.trip",
  defaultMax: 30,
  defaultWindowMs: 10 * 1000,
  message:
    "Too many notification requests in a short window. Please slow down and try again shortly.",
});

export const NOTIFICATIONS_RATE_LIMIT_CONFIG = limiter.CONFIG;
export const getNotificationsBudgetForRole = limiter.getBudgetForRole;
export const recordNotificationsHit = limiter.recordHit;
export const enforceNotificationsRateLimit = limiter.enforce;
export const getNotificationsRateLimitKey = limiter.getRateLimitKey;
export const summarizeRecentNotificationsTrips = limiter.summarizeRecentTrips;
export const __resetNotificationsRateLimitStateForTests =
  limiter.__resetStateForTests;
