import { createRateLimiter } from "./rate-limit-factory";

// Per-session rate limit on the comment-thread read endpoints
// (`/api/tickets/:id/comments`, `/api/hotlist/jobs/:id/comments`).
// These threads are SSE-invalidated: every "created"/"updated"/
// "deleted" event on the hotlist channel triggers a refetch of the
// whole thread, and the comments panel marks-as-seen as a side
// effect of the GET (an additional write per fetch). A misbehaving
// client that opens many panels at once, or a thread with rapid-fire
// events from a script, could cascade into a tight refetch loop.
//
// Default budget = 30 req / 10 s, matching tickets/notifications.
// That accommodates several SSE-driven refetches per second per
// active thread before tripping. Per-role overrides:
// `COMMENTS_RATE_LIMIT_MAX_<ROLE>` /
// `COMMENTS_RATE_LIMIT_WINDOW_MS_<ROLE>`, so e.g. dispatchers
// monitoring many active threads can be granted more headroom than
// a vendor scrolling a single one.
const limiter = createRateLimiter({
  resourcePrefix: "COMMENTS",
  errorCode: "comments.rate_limited",
  logKind: "comments.rate_limit.trip",
  defaultMax: 30,
  defaultWindowMs: 10 * 1000,
  message:
    "Too many comment requests in a short window. Please slow down and try again shortly.",
});

export const COMMENTS_RATE_LIMIT_CONFIG = limiter.CONFIG;
export const getCommentsBudgetForRole = limiter.getBudgetForRole;
export const recordCommentsHit = limiter.recordHit;
export const enforceCommentsRateLimit = limiter.enforce;
export const getCommentsRateLimitKey = limiter.getRateLimitKey;
export const summarizeRecentCommentsTrips = limiter.summarizeRecentTrips;
export const __resetCommentsRateLimitStateForTests =
  limiter.__resetStateForTests;
