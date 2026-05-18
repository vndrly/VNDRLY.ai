import type { Request } from "express";
import { type BucketStore, getDefaultBucketStore } from "./bucket-store";

// Abuse controls for the unauthenticated signup-page assistant
// (`POST /assistant/signup/:persona/chat`). The endpoint is fully
// anonymous (no session, no token), so without these controls a
// single script could hammer it and burn unbounded LLM credits
// against our Anthropic key.
//
// Two layers, both backed by a shared `BucketStore`:
//
//   1. Per-IP fixed-window limiter — blunts script attacks from a
//      single source. Default 20 messages / 15 min / IP. Lives in
//      bucket namespace `SIGNUP_ASSISTANT_IP`.
//   2. Daily call-count circuit breaker — global per-DAY ceiling on
//      successful Anthropic dispatches. Default 2,000 calls/day.
//      Lives in bucket namespace `SIGNUP_ASSISTANT_DAILY`, keyed by
//      the UTC day-string. Rollover is automatic: at 00:00 UTC the
//      day key changes, so the next call lands on a fresh bucket.
//      The previous day's bucket auto-expires via the store's
//      opportunistic sweep.
//
// Backing store (Task #777): the default backend is the process-wide
// shared `BucketStore` resolved by `getDefaultBucketStore()` — the
// same store used by `rate-limit-factory.ts` and the tickets
// limiter. That means signup-assistant counters land on Redis
// whenever `RATE_LIMIT_REDIS_URL` (or `REDIS_URL`) is configured, so
// the per-IP window and daily circuit breaker stay accurate across
// API replicas. With no Redis URL set the resolver falls back to
// `MemoryBucketStore`, matching the per-replica behaviour of every
// other limiter in this codebase. Tests inject a fresh
// `MemoryBucketStore` via `__setSignupAssistantStoreForTests` so
// they remain hermetic and don't observe singleton bleed-over.

const IP_NAMESPACE = "SIGNUP_ASSISTANT_IP";
const DAILY_NAMESPACE = "SIGNUP_ASSISTANT_DAILY";

// The daily bucket's TTL has to comfortably outlast the day it's
// keyed under so a hit at 23:59:59 UTC still reads the same bucket
// for the rest of that day. 36h gives us 12h of headroom past
// midnight without keeping stale buckets around for long.
const DAILY_TTL_MS = 36 * 60 * 60 * 1000;

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Env reads are lazy (per call) so per-test `process.env` overrides
// take effect without resetting the module graph and so an operator
// can change the budget by editing the env and rolling the process.
function ipWindowMs(): number {
  return envPositiveInt(
    "SIGNUP_ASSISTANT_IP_WINDOW_MS",
    15 * 60 * 1000,
  );
}
function ipMax(): number {
  return envPositiveInt("SIGNUP_ASSISTANT_IP_MAX", 20);
}
function dailyBudget(): number {
  return envPositiveInt("SIGNUP_ASSISTANT_DAILY_BUDGET", 2000);
}

export const SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG = {
  get ipWindowMs(): number {
    return ipWindowMs();
  },
  get ipMax(): number {
    return ipMax();
  },
  get dailyBudget(): number {
    return dailyBudget();
  },
};

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Test injection point. Falls back to the process-wide shared
// `BucketStore` (Redis when configured, in-process map otherwise),
// so per-test isolation can be achieved by calling
// `__setSignupAssistantStoreForTests(new MemoryBucketStore())`.
let storeOverride: BucketStore | null = null;
function getStore(): BucketStore {
  return storeOverride ?? getDefaultBucketStore();
}

/** Test-only: inject a specific store instead of the default singleton. */
export function __setSignupAssistantStoreForTests(
  store: BucketStore | null,
): void {
  storeOverride = store;
}

/**
 * Best-effort client-IP extraction. Reads the leftmost
 * `x-forwarded-for` entry (Replit's edge proxy populates this with
 * the visitor's IP), falling back to the socket's remote address if
 * no header is present.
 *
 * `x-forwarded-for` is technically client-spoofable, but for this
 * limiter that's acceptable: spoofing a different IP per request
 * just means abuse traffic also has to burn through the global
 * daily budget, which is the real cost ceiling. We do not change
 * the `app.set('trust proxy', ...)` global so other call sites that
 * read `req.ip` keep their existing behaviour.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  } else if (Array.isArray(xff) && xff.length > 0) {
    const first = xff[0]?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? req.ip ?? "unknown";
}

export interface IpHitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
  windowMs: number;
}

/**
 * Record a hit from `ip` against the per-IP limiter and return
 * whether the request is allowed. Fixed-window: each IP gets
 * `IP_MAX` calls within `IP_WINDOW_MS`, then resets.
 */
export async function recordIpHit(
  ip: string,
  now: number = Date.now(),
): Promise<IpHitResult> {
  const max = ipMax();
  const windowMs = ipWindowMs();
  const { count, resetAt } = await getStore().increment(
    IP_NAMESPACE,
    ip,
    windowMs,
    now,
  );
  if (count > max) {
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(1, resetAt - now),
      limit: max,
      windowMs,
    };
  }
  return {
    ok: true,
    remaining: max - count,
    retryAfterMs: Math.max(1, resetAt - now),
    limit: max,
    windowMs,
  };
}

export interface DailyConsumeResult {
  ok: boolean;
  used: number;
  budget: number;
  remaining: number;
  dayKey: string;
}

/**
 * Try to consume one unit of the daily budget. Returns `ok: false`
 * if the budget for the current UTC day is already exhausted;
 * otherwise increments and returns the new state. UTC-midnight
 * rollover is automatic because the bucket key includes the day
 * string — at 00:00 UTC the next call lands on a fresh bucket.
 */
export async function consumeDailyBudget(
  now: number = Date.now(),
): Promise<DailyConsumeResult> {
  const budget = dailyBudget();
  const dayKey = utcDayKey(new Date(now));
  const { count } = await getStore().increment(
    DAILY_NAMESPACE,
    dayKey,
    DAILY_TTL_MS,
    now,
  );
  if (count > budget) {
    // Already saturated for the day: this hit is rejected. The
    // INCR still landed (atomicity beats accuracy here — the abuse
    // signal stays counted in observability), but the user-facing
    // `used` is clamped to `budget` so the dashboard tile never
    // shows "2001 / 2000".
    return {
      ok: false,
      used: budget,
      budget,
      remaining: 0,
      dayKey,
    };
  }
  return {
    ok: true,
    used: count,
    budget,
    remaining: budget - count,
    dayKey,
  };
}

export interface SignupAssistantUsage {
  dayKey: string;
  used: number;
  budget: number;
  activeIpBuckets: number;
  ipMax: number;
  ipWindowMs: number;
}

/**
 * Read-only snapshot of current signup-assistant usage for the
 * admin metrics card. Reads through the shared store via `peek`
 * (no INCR), so calling this never burns daily budget. The
 * `activeIpBuckets` count is an estimate when running on Redis
 * (SCAN may briefly include lazily-evicted keys); on the in-memory
 * store it is exact.
 */
export async function getSignupAssistantUsage(
  now: number = Date.now(),
): Promise<SignupAssistantUsage> {
  const dayKey = utcDayKey(new Date(now));
  const store = getStore();
  const peek = await store.peek(DAILY_NAMESPACE, dayKey, now);
  const used = peek ? Math.min(peek.count, dailyBudget()) : 0;
  const activeIpBuckets = await store.countActive(IP_NAMESPACE, now);
  return {
    dayKey,
    used,
    budget: dailyBudget(),
    activeIpBuckets,
    ipMax: ipMax(),
    ipWindowMs: ipWindowMs(),
  };
}

/** Test-only helper to wipe in-memory state between cases. */
export async function __resetSignupAssistantStateForTests(): Promise<void> {
  const store = getStore();
  await store.reset(IP_NAMESPACE);
  await store.reset(DAILY_NAMESPACE);
  perDayDigest = null;
}

// ─────────────────────────────────────────────────────────────────
// Daily digest aggregator (in-memory)
//
// Separate from the abuse-control state above. The per-IP and daily
// counters live in the shared `BucketStore` (Redis when configured)
// because they enforce real cost ceilings across replicas. The
// digest aggregator below is ONLY used to compose the daily admin
// abuse-summary email, so it intentionally lives in process memory:
//
//   • It only needs to be approximately right — the email is a
//     human heads-up, not an enforcement mechanism. Per-replica
//     drift across a small fleet is fine.
//   • It avoids the SCAN-on-Redis cost of enumerating every per-IP
//     daily key just to compute a top-N list. The shared store
//     never had a "list keys with values" primitive and we don't
//     want to add one for an email.
//
// Reset rules:
//   • The aggregator is keyed by today's UTC dayKey. When the day
//     rolls over, the next call discards the previous day's map and
//     installs a fresh one.
//   • A bounded cap (`MAX_TRACKED_IPS`) prevents a flood of unique
//     spoofed IPs from growing the map unbounded — once full, new
//     IPs are dropped silently. The top-N list still surfaces the
//     real heavy hitters because they're the IPs that landed early
//     and stayed.
// ─────────────────────────────────────────────────────────────────

interface PerDayDigest {
  dayKey: string;
  /** Total chat-turn requests received from `/assistant/signup/...`
   *  on this UTC day, including ones that were blocked by either
   *  abuse layer. Useful denominator for the email summary. */
  totalRequests: number;
  /** Number of requests that actually dispatched to Anthropic
   *  (passed both abuse gates). */
  totalDispatched: number;
  /** Number of requests rejected by the per-IP fixed-window limiter. */
  ipBlocks: number;
  /** Number of requests rejected because the daily circuit breaker
   *  was already tripped. */
  breakerTripped: number;
  /** ip -> {requests, dispatched} for the current day. Bounded. */
  ipCounts: Map<string, { requests: number; dispatched: number }>;
}

const MAX_TRACKED_IPS = 1000;
let perDayDigest: PerDayDigest | null = null;

function ensureCurrentDigest(now: number): PerDayDigest {
  const dayKey = utcDayKey(new Date(now));
  if (!perDayDigest || perDayDigest.dayKey !== dayKey) {
    perDayDigest = {
      dayKey,
      totalRequests: 0,
      totalDispatched: 0,
      ipBlocks: 0,
      breakerTripped: 0,
      ipCounts: new Map(),
    };
  }
  return perDayDigest;
}

export interface DigestHitInput {
  /** The request reached Anthropic (both gates passed). */
  dispatched: boolean;
  /** The per-IP limiter rejected this request. */
  ipBlocked: boolean;
  /** The daily breaker rejected this request. */
  breakerTripped: boolean;
}

/**
 * Record a single signup-assistant chat-turn request for the
 * abuse-summary email. Counted regardless of which abuse layer
 * accepted or rejected the request — the email needs the full
 * picture (volume, who hit limits, did the breaker open).
 *
 * Cheap: an in-memory Map update with a soft cap. Never throws.
 */
export function recordSignupAssistantDigestHit(
  ip: string,
  hit: DigestHitInput,
  now: number = Date.now(),
): void {
  const digest = ensureCurrentDigest(now);
  digest.totalRequests += 1;
  if (hit.dispatched) digest.totalDispatched += 1;
  if (hit.ipBlocked) digest.ipBlocks += 1;
  if (hit.breakerTripped) digest.breakerTripped += 1;
  const existing = digest.ipCounts.get(ip);
  if (existing) {
    existing.requests += 1;
    if (hit.dispatched) existing.dispatched += 1;
    return;
  }
  if (digest.ipCounts.size >= MAX_TRACKED_IPS) {
    // Cap reached: silently drop. The top-N list still reflects the
    // real heavy hitters (which were tracked from the moment they
    // first appeared); we just stop recording new low-volume IPs.
    return;
  }
  digest.ipCounts.set(ip, {
    requests: 1,
    dispatched: hit.dispatched ? 1 : 0,
  });
}

export interface DigestTopIp {
  ip: string;
  requests: number;
  dispatched: number;
}

export interface SignupAssistantDigestSnapshot {
  dayKey: string;
  totalRequests: number;
  totalDispatched: number;
  ipBlocks: number;
  breakerTripped: number;
  uniqueIps: number;
  topIps: DigestTopIp[];
}

/**
 * Snapshot of the digest aggregator for the abuse-summary email.
 * If the in-memory state belongs to a previous UTC day (because the
 * worker tick fires after midnight), the snapshot is empty — that's
 * intentional, the digest worker calls this BEFORE the day rolls
 * over so it captures today's state.
 */
export function getSignupAssistantDigestSnapshot(
  topN = 10,
  now: number = Date.now(),
): SignupAssistantDigestSnapshot {
  const dayKey = utcDayKey(new Date(now));
  if (!perDayDigest || perDayDigest.dayKey !== dayKey) {
    return {
      dayKey,
      totalRequests: 0,
      totalDispatched: 0,
      ipBlocks: 0,
      breakerTripped: 0,
      uniqueIps: 0,
      topIps: [],
    };
  }
  const sorted = Array.from(perDayDigest.ipCounts.entries())
    .map(([ip, c]) => ({ ip, requests: c.requests, dispatched: c.dispatched }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, Math.max(0, topN));
  return {
    dayKey: perDayDigest.dayKey,
    totalRequests: perDayDigest.totalRequests,
    totalDispatched: perDayDigest.totalDispatched,
    ipBlocks: perDayDigest.ipBlocks,
    breakerTripped: perDayDigest.breakerTripped,
    uniqueIps: perDayDigest.ipCounts.size,
    topIps: sorted,
  };
}
