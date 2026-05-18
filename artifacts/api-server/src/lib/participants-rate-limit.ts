import { createRateLimiter } from "./rate-limit-factory";

// Per-session rate limit on the mention-picker participants
// endpoints (`GET /api/tickets/:id/comments-participants`,
// `GET /api/hotlist/jobs/:id/comments-participants`). These power
// the "@" mention dropdown in the comments composer; each open of
// the picker performs a participant-graph lookup followed by a
// users-by-id fan-out. A bug that re-renders the picker on every
// keystroke, a bot scraping participant lists across thread ids,
// or a runaway component effect could otherwise repeat that
// lookup hundreds of times per second per session.
//
// Default budget = 30 req / 10 s, matching the rest of the
// per-resource limiters — comfortably above the realistic open /
// reopen cadence of a mention picker while still tripping on a
// tight loop. Per-role overrides:
// `PARTICIPANTS_RATE_LIMIT_MAX_<ROLE>` /
// `PARTICIPANTS_RATE_LIMIT_WINDOW_MS_<ROLE>`, so e.g. dispatchers
// composing many mentions at once can be granted more headroom
// than a vendor occasionally using @-mentions.
const limiter = createRateLimiter({
  resourcePrefix: "PARTICIPANTS",
  errorCode: "participants.rate_limited",
  logKind: "participants.rate_limit.trip",
  defaultMax: 30,
  defaultWindowMs: 10 * 1000,
  message:
    "Too many mention-picker requests in a short window. Please slow down and try again shortly.",
});

export const PARTICIPANTS_RATE_LIMIT_CONFIG = limiter.CONFIG;
export const getParticipantsBudgetForRole = limiter.getBudgetForRole;
export const recordParticipantsHit = limiter.recordHit;
export const enforceParticipantsRateLimit = limiter.enforce;
export const getParticipantsRateLimitKey = limiter.getRateLimitKey;
export const summarizeRecentParticipantsTrips = limiter.summarizeRecentTrips;
export const __resetParticipantsRateLimitStateForTests =
  limiter.__resetStateForTests;
