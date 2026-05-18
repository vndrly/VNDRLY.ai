import type { Request, Response } from "express";
import {
  type BucketStore,
  getDefaultBucketStore,
} from "./bucket-store";
import { logger } from "./logger";
import { getClientIp } from "./signup-assistant-rate-limit";

// Generic per-key fixed-window rate limiter, factored out of the
// `tickets-rate-limit.ts` implementation introduced in tasks #675/#687
// so that other hot read endpoints (notifications, comments, hotlist
// jobs, …) can adopt the same role-aware budget pattern without
// re-implementing the bucketing, eviction, role sanitization, env-var
// resolution, and 429-response shape.
//
// Each call to `createRateLimiter` produces an INDEPENDENT limiter:
//   • its own bucket NAMESPACE in the shared `BucketStore` (so a user
//     hammering /comments doesn't burn through their /tickets budget
//     — each resource has its own budget; the namespace is the
//     uppercased resource prefix)
//   • its own env-var prefix (`<RESOURCE>_RATE_LIMIT_MAX[_<ROLE>]`,
//     `<RESOURCE>_RATE_LIMIT_WINDOW_MS[_<ROLE>]`) so operators can
//     tune each resource independently
//   • its own 429 `code` and log `kind` so client branching and
//     observability stay per-resource
//
// Behaviour mirrors the original `tickets-rate-limit.ts`: lazy env
// reads, per-role overrides keyed on a sanitized role string,
// fixed-window counter, structured 429 with `Retry-After`, and a
// bounded bucket map.
//
// Task #700 introduced `BucketStore`, which abstracts the bucket
// counters behind an atomic `increment(namespace, key, windowMs,
// now)` call. The default store is selected by `bucket-store.ts`:
// Redis when `RATE_LIMIT_REDIS_URL` (or `REDIS_URL`) is set so
// counters are accurate across replicas, otherwise an in-process
// `MemoryBucketStore` so local dev and tests keep working unchanged.
// The cross-replica atomicity guarantee is exercised end-to-end by
// the opt-in `bucket-store.integration.test.ts` suite (Task #775);
// see the header comment in `bucket-store.ts` for how to opt in via
// `REDIS_TEST_URL`.

// Roles are looked up by composing an env-var name from the role
// string, so we tightly constrain which role strings are allowed to
// drive that lookup. Same pattern as `tickets-rate-limit.ts`: short,
// lowercase, snake_case identifiers, which covers every role the auth
// layer issues today (admin, vendor, partner, field_employee, guest,
// dispatcher, …) while preventing a malformed/spoofed role from
// reading or shadowing an unrelated env var.
const ROLE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  // Require a positive integer — fractional or non-finite values
  // would produce odd limiter semantics (e.g. `max: 2.5`), so we
  // refuse them and fall back to the safe default.
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export interface RateBudget {
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
  windowMs: number;
}

export interface RateLimiterOptions {
  /**
   * Resource label used to compose env var names AND the bucket
   * namespace in the shared store. Will be uppercased, so e.g.
   * `"comments"` → env vars `COMMENTS_RATE_LIMIT_MAX[_<ROLE>]` /
   * `COMMENTS_RATE_LIMIT_WINDOW_MS[_<ROLE>]` and bucket keys
   * `<store-prefix>:COMMENTS:<key>`. Per-resource prefixes keep
   * operator tuning of one endpoint from accidentally affecting
   * another, and keep counters independent even when every limiter
   * shares the same backing store.
   */
  resourcePrefix: string;
  /**
   * `code` field returned in the 429 JSON body. The web/mobile
   * clients branch on this to choose the right "slow down" UX (e.g.
   * the comments panel reconnect pill vs the tickets refresh
   * cooldown). Convention: `"<resource>.rate_limited"`.
   */
  errorCode: string;
  /**
   * Pino log `kind` for the trip warning, so dashboards and alert
   * rules can target each resource separately. Convention:
   * `"<resource>.rate_limit.trip"`.
   */
  logKind: string;
  /** Default max requests per window when no env override is set. */
  defaultMax: number;
  /** Default window length in ms when no env override is set. */
  defaultWindowMs: number;
  /**
   * User-facing message in the 429 JSON body. Should be specific
   * enough that a developer reading the response knows which
   * endpoint tripped, but generic enough to surface to end users.
   */
  message: string;
  /**
   * Optional bucket store override. Defaults to the process-wide
   * shared store resolved by `getDefaultBucketStore()`. Tests use
   * this to inject a fresh `MemoryBucketStore` per case so they
   * don't observe cross-test bleed-over via the singleton.
   */
  store?: BucketStore;
  /**
   * Optional override for the in-process 429 trips ring buffer
   * sizing (Task #696). Defaults to `DEFAULT_TRIPS_BUFFER_OPTIONS`
   * (2,000 entries × 24 h). Tests pass tighter values to exercise
   * eviction without thousands of synthetic trips.
   */
  tripsBufferOptions?: RateLimitTripsBufferOptions;
}

/**
 * One recorded 429 trip on a per-resource limiter. Captured into the
 * limiter's in-process ring buffer (Task #696) so the operations
 * dashboard can render "trips in last hour / day, by role" without
 * having to grep API logs for the `*.rate_limit.trip` warn line.
 *
 * Survives only as long as the API process is up — by design. The
 * buffer is per-replica (not shared via the BucketStore) and
 * deliberately small, so it stays an at-a-glance ops aid rather
 * than a forensic data store.
 */
export interface RateLimitTrip {
  /** Wall-clock ms when the trip happened. */
  ts: number;
  /** Session role string at trip time, or `null` for unauthenticated. */
  role: string | null;
  /** Per-session/IP key the limiter rejected. */
  key: string;
}

export interface RateLimitTripRoleSummary {
  /** Role string, or `"unknown"` for unauthenticated/null. */
  role: string;
  /** Total trip count from this role in the window. */
  trips: number;
  /** Number of distinct session/IP keys this role tripped from. */
  uniqueKeys: number;
}

export interface RateLimitTripWindowSummary {
  /** Window length in ms (e.g. 60 * 60 * 1000 for "last hour"). */
  windowMs: number;
  /** Total trips inside the window across all roles. */
  totalTrips: number;
  /**
   * Distinct session/IP keys inside the window across all roles.
   * Useful to distinguish "one runaway client" from "many clients
   * collectively bumping the cap".
   */
  uniqueKeys: number;
  /**
   * Per-role breakdown, sorted by trips descending so the noisiest
   * role is first. Only roles with at least one trip in the window
   * appear; quiet roles are omitted to keep the readout focused.
   */
  byRole: RateLimitTripRoleSummary[];
}

/** Tunable limits for each limiter's trip ring buffer. */
export interface RateLimitTripsBufferOptions {
  /**
   * Hard cap on entries kept in memory. Once exceeded, the oldest
   * entries are evicted FIFO. Sized so a sustained burst still
   * leaves enough history for the longest dashboard window.
   */
  maxEntries: number;
  /**
   * Maximum age in ms an entry may live before it's evicted on the
   * next push. Should be at least as long as the largest dashboard
   * window so a quiet hour doesn't blank the readout.
   */
  retentionMs: number;
}

/**
 * Default ring-buffer sizing for the per-limiter trips buffer.
 * 2,000 entries × 24h retention sized so the dashboard can render
 * "last 60 min" and "last 24 h" without ever wrapping during a
 * normal day, while keeping per-replica memory cost trivial
 * (~80 bytes/entry × 2k = ~160 KB per limiter even at saturation).
 */
export const DEFAULT_TRIPS_BUFFER_OPTIONS: RateLimitTripsBufferOptions = {
  maxEntries: 2_000,
  retentionMs: 24 * 60 * 60 * 1000,
};

export interface RateLimiter {
  /**
   * Live snapshot of the current default (role-less) budget. Reads
   * env vars on every property access so per-test `vi.stubEnv`
   * overrides take effect without resetting modules.
   */
  readonly CONFIG: { readonly max: number; readonly windowMs: number };
  /** Resolve the budget for a given session role (or null/unknown). */
  getBudgetForRole(role: string | null | undefined): RateBudget;
  /** Build a stable per-key string for the request. */
  getRateLimitKey(
    req: Request,
    session: { userId: number } | null,
  ): string;
  /** Record one hit; report whether it was allowed. */
  recordHit(
    key: string,
    budget?: RateBudget,
    now?: number,
  ): Promise<RateLimitResult>;
  /**
   * Apply the limiter to a route response. On trip writes 429 with
   * `Retry-After` plus a structured JSON body and returns `false`
   * so the caller can early-return. On allow returns `true`.
   */
  enforce(
    req: Request,
    res: Response,
    session: { userId: number; role?: string | null } | null,
  ): Promise<boolean>;
  /**
   * Snapshot of every retained 429 trip on this limiter, oldest
   * first. Filter by `sinceMs` to cap the window the caller cares
   * about (e.g. `60 * 60 * 1000` for "last hour"). Returns a
   * defensive copy so callers can't mutate the buffer.
   */
  getRecentTrips(opts?: { sinceMs?: number; now?: number }): RateLimitTrip[];
  /**
   * Aggregate `getRecentTrips` into a per-role breakdown for one or
   * more windows. The dashboard uses this directly to render the
   * "trips in last hour / day" panel without re-implementing the
   * grouping logic in the UI.
   */
  summarizeRecentTrips(opts: {
    windowMs: number;
    now?: number;
  }): RateLimitTripWindowSummary;
  /**
   * Tuning knobs and current size of the ring buffer. Surfaced to
   * the admin endpoint so an operator can tell at a glance whether
   * the buffer was full when they looked (i.e. "trips happened
   * before this entry but were evicted").
   */
  getTripsBufferInfo(): {
    maxEntries: number;
    retentionMs: number;
    currentSize: number;
    /** Oldest retained trip ts, or null if the buffer is empty. */
    oldestTrackedAt: number | null;
  };
  /** Test-only helper to wipe in-memory state between cases. */
  __resetStateForTests(): Promise<void>;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const {
    resourcePrefix,
    errorCode,
    logKind,
    defaultMax: builtInMax,
    defaultWindowMs: builtInWindowMs,
    message,
    store: explicitStore,
    tripsBufferOptions = DEFAULT_TRIPS_BUFFER_OPTIONS,
  } = opts;

  // Per-limiter, per-replica ring buffer of recent 429 trips
  // (Task #696). Deliberately in-process: when a replica restarts
  // its history clears, which is fine for an at-a-glance ops aid
  // (the persistent record lives in the structured `${logKind}`
  // log line). Entries are appended on each rejected request and
  // pruned on the next push by both `maxEntries` (FIFO cap) and
  // `retentionMs` (age cap, applied first), so a quiet hour after
  // an old burst can still age the buffer out without needing a
  // new trip to evict it. We accept the worst case of a stale
  // entry until the next push because the dashboard always
  // re-filters by `sinceMs` on read.
  const tripsBuffer: RateLimitTrip[] = [];
  const { maxEntries: tripsMaxEntries, retentionMs: tripsRetentionMs } =
    tripsBufferOptions;

  // The bucket namespace in the shared store. Uppercased so it
  // matches the env-var prefix convention and so two limiters
  // configured with the same logical resource can't accidentally
  // collide on case alone.
  const namespace = resourcePrefix.toUpperCase();

  // Lazily resolve the store: when no explicit store is passed we
  // defer to the singleton resolver so an env var (`RATE_LIMIT_REDIS_URL`)
  // set after this factory call still wins. Once resolved it's
  // memoised by the resolver so we don't keep re-reading env.
  function getStore(): BucketStore {
    return explicitStore ?? getDefaultBucketStore();
  }

  // Env reads are lazy (per call) so per-role overrides applied via
  // `vi.stubEnv` in tests take effect without resetting the module
  // graph, and so an operator can change the budget by editing the
  // env and rolling the process.
  function defaultMax(): number {
    return envPositiveInt(`${resourcePrefix}_RATE_LIMIT_MAX`, builtInMax);
  }
  function defaultWindowMs(): number {
    return envPositiveInt(
      `${resourcePrefix}_RATE_LIMIT_WINDOW_MS`,
      builtInWindowMs,
    );
  }

  const CONFIG = {
    get max(): number {
      return defaultMax();
    },
    get windowMs(): number {
      return defaultWindowMs();
    },
  };

  function getBudgetForRole(role: string | null | undefined): RateBudget {
    const baseMax = defaultMax();
    const baseWindow = defaultWindowMs();
    if (!role || !ROLE_PATTERN.test(role)) {
      return { max: baseMax, windowMs: baseWindow };
    }
    const upper = role.toUpperCase();
    return {
      max: envPositiveInt(
        `${resourcePrefix}_RATE_LIMIT_MAX_${upper}`,
        baseMax,
      ),
      windowMs: envPositiveInt(
        `${resourcePrefix}_RATE_LIMIT_WINDOW_MS_${upper}`,
        baseWindow,
      ),
    };
  }

  async function recordHit(
    key: string,
    budget: RateBudget = { max: defaultMax(), windowMs: defaultWindowMs() },
    now: number = Date.now(),
  ): Promise<RateLimitResult> {
    const { max, windowMs } = budget;
    const store = getStore();
    const { count, resetAt } = await store.increment(
      namespace,
      key,
      windowMs,
      now,
    );
    if (count > max) {
      // Already over the cap: this hit is rejected. Note that we
      // still consumed an INCR — that's intentional because it
      // keeps the abuse signal counted in observability and makes
      // the Lua/Map paths trivially idempotent. We just don't
      // serve the request.
      const retryAfterMs = Math.max(1, resetAt - now);
      return {
        ok: false,
        remaining: 0,
        retryAfterMs,
        limit: max,
        windowMs,
      };
    }
    return {
      ok: true,
      remaining: max - count,
      // For a fresh window the reset is exactly `windowMs` from now;
      // for an in-progress window it's the remaining TTL. Both come
      // from the same `resetAt` field returned by the store.
      retryAfterMs: Math.max(1, resetAt - now),
      limit: max,
      windowMs,
    };
  }

  function getRateLimitKey(
    req: Request,
    session: { userId: number } | null,
  ): string {
    if (session && Number.isFinite(session.userId)) {
      return `u:${session.userId}`;
    }
    return `ip:${getClientIp(req)}`;
  }

  function pruneTripsBuffer(now: number): void {
    // Age-based eviction first: drop everything older than
    // retentionMs from the head. The buffer is push-appended in
    // wall-clock order, so a single linear scan from the front is
    // both correct and cheap (≤ maxEntries).
    const cutoff = now - tripsRetentionMs;
    let drop = 0;
    while (drop < tripsBuffer.length && tripsBuffer[drop].ts < cutoff) {
      drop += 1;
    }
    if (drop > 0) tripsBuffer.splice(0, drop);
    // Hard cap: if we've blown past `maxEntries` after appending,
    // shift the oldest few off so the buffer never grows unbounded
    // even during a sustained abuse storm.
    if (tripsBuffer.length > tripsMaxEntries) {
      tripsBuffer.splice(0, tripsBuffer.length - tripsMaxEntries);
    }
  }

  function recordTrip(role: string | null, key: string, now: number): void {
    tripsBuffer.push({ ts: now, role, key });
    pruneTripsBuffer(now);
  }

  function getRecentTrips(
    opts: { sinceMs?: number; now?: number } = {},
  ): RateLimitTrip[] {
    const now = opts.now ?? Date.now();
    // Prune lazily on read too — otherwise a limiter that hasn't
    // tripped in 25 hours would still be returning yesterday's
    // entries until the next push prunes them. Cheap (linear in
    // buffer size, capped at maxEntries).
    pruneTripsBuffer(now);
    const sinceMs = opts.sinceMs;
    if (sinceMs === undefined) {
      // Defensive copy — callers might sort/mutate.
      return tripsBuffer.map((t) => ({ ...t }));
    }
    const cutoff = now - sinceMs;
    return tripsBuffer
      .filter((t) => t.ts >= cutoff)
      .map((t) => ({ ...t }));
  }

  function summarizeRecentTrips(opts: {
    windowMs: number;
    now?: number;
  }): RateLimitTripWindowSummary {
    const now = opts.now ?? Date.now();
    const trips = getRecentTrips({ sinceMs: opts.windowMs, now });
    // Bucket by role string ("unknown" stands in for null so the
    // UI doesn't have to special-case it). Track distinct keys
    // per role with a small Set; the buffer is bounded so this is
    // cheap even when the dashboard polls.
    const roleAgg = new Map<string, { trips: number; keys: Set<string> }>();
    const allKeys = new Set<string>();
    for (const t of trips) {
      const roleLabel = t.role ?? "unknown";
      let entry = roleAgg.get(roleLabel);
      if (!entry) {
        entry = { trips: 0, keys: new Set<string>() };
        roleAgg.set(roleLabel, entry);
      }
      entry.trips += 1;
      entry.keys.add(t.key);
      allKeys.add(t.key);
    }
    const byRole: RateLimitTripRoleSummary[] = Array.from(roleAgg.entries())
      .map(([role, agg]) => ({
        role,
        trips: agg.trips,
        uniqueKeys: agg.keys.size,
      }))
      .sort((a, b) => b.trips - a.trips || a.role.localeCompare(b.role));
    return {
      windowMs: opts.windowMs,
      totalTrips: trips.length,
      uniqueKeys: allKeys.size,
      byRole,
    };
  }

  function getTripsBufferInfo() {
    return {
      maxEntries: tripsMaxEntries,
      retentionMs: tripsRetentionMs,
      currentSize: tripsBuffer.length,
      oldestTrackedAt: tripsBuffer.length > 0 ? tripsBuffer[0].ts : null,
    };
  }

  async function enforce(
    req: Request,
    res: Response,
    session: { userId: number; role?: string | null } | null,
  ): Promise<boolean> {
    const key = getRateLimitKey(req, session);
    const budget = getBudgetForRole(session?.role ?? null);
    const hit = await recordHit(key, budget);
    if (hit.ok) return true;

    const now = Date.now();
    const role = session?.role ?? null;
    // Capture the trip in the in-process ring buffer so the admin
    // dashboard can render "trips in last hour / day, by role"
    // without grepping logs (Task #696). We do this before the
    // 429 write so the recording can never be skipped by an early
    // return on a write error.
    recordTrip(role, key, now);

    const retryAfterSeconds = Math.max(1, Math.ceil(hit.retryAfterMs / 1000));
    logger.warn(
      {
        kind: logKind,
        key,
        role,
        path: req.path,
        method: req.method,
        limit: hit.limit,
        windowMs: hit.windowMs,
        retryAfterMs: hit.retryAfterMs,
      },
      `${resourcePrefix.toLowerCase()} endpoint rate limit hit`,
    );
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      error: "rate_limited",
      code: errorCode,
      message,
      retryAfterSeconds,
      limit: hit.limit,
      windowMs: hit.windowMs,
    });
    return false;
  }

  async function __resetStateForTests(): Promise<void> {
    await getStore().reset(namespace);
    tripsBuffer.length = 0;
  }

  return {
    CONFIG,
    getBudgetForRole,
    getRateLimitKey,
    recordHit,
    enforce,
    getRecentTrips,
    summarizeRecentTrips,
    getTripsBufferInfo,
    __resetStateForTests,
  };
}
