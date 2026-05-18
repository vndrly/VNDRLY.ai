import { createRequire } from "node:module";
import { logger } from "./logger";

// `createRequire` lets us load the CJS-only `ioredis` package on
// demand from this ESM module without a top-level `import`. Only
// invoked when a Redis URL is actually configured, so a deploy
// without Redis never touches the dependency.
const nodeRequire = createRequire(import.meta.url);

// Backing store for the role-aware fixed-window rate limiters
// (`rate-limit-factory.ts`, `tickets-rate-limit.ts`). Task #700:
// the API server originally kept its bucket counters in process
// memory (`Map<string, BucketEntry>` per limiter). That works for a
// single Node process, but the moment we scale horizontally each
// replica enforces its own per-replica budget — a user routed across
// N replicas effectively gets N× the cap. The factory always
// intended for the storage backend to be swappable; this module is
// that swap point.
//
// Two implementations:
//   • `MemoryBucketStore` — preserves the previous in-process
//     behaviour. Used for local dev, tests, and any deployment where
//     no shared store is configured. Identical semantics to the
//     pre-task #700 maps (per-key bucket, fixed window, bounded with
//     LRU-by-reset eviction).
//   • `RedisBucketStore` — atomic INCR + PEXPIRE per (namespace,
//     key) implemented as a Lua script so the increment, the TTL
//     check, and the window install happen as one round-trip and
//     can't race across replicas. Survives restarts and is the
//     correct choice once the API server scales out.
//
// `getDefaultBucketStore()` resolves the right implementation lazily
// from the environment so production picks Redis automatically when
// `RATE_LIMIT_REDIS_URL` (or `REDIS_URL`) is set, and dev/tests stay
// on the in-process map without any code change.
//
// Test coverage:
//   • `bucket-store.test.ts` — unit tests against `MemoryBucketStore`
//     and a structural fake `RedisLikeClient`. Always run.
//   • `bucket-store.redis.integration.test.ts` — opt-in real-Redis
//     suite that proves the INCR + PEXPIRE Lua script behaves
//     atomically across replicas (two independent ioredis clients
//     pointed at the same key). Skipped (not failed) unless
//     `REDIS_TEST_URL` is set, e.g.
//       docker run --rm -p 6379:6379 redis:7
//       REDIS_TEST_URL=redis://localhost:6379 \
//         pnpm --filter @workspace/api-server run test:no-isolated-db \
//         src/lib/bucket-store.redis.integration.test.ts

/** Result of an atomic increment against a fixed-window bucket. */
export interface BucketIncrementResult {
  /** Total hits in the current window after this increment. */
  count: number;
  /** Wall-clock ms since epoch when the current window resets. */
  resetAt: number;
}

/**
 * Storage backend for the rate-limit factory's bucket counters.
 *
 * Implementations MUST make `increment` atomic w.r.t. concurrent
 * callers on the same `(namespace, key)` — that's the whole point of
 * the abstraction. The Memory store is single-Node-process atomic by
 * virtue of the JS event loop; the Redis store achieves it via a
 * Lua script that runs server-side.
 *
 * Each limiter created by `createRateLimiter` passes its own
 * `namespace` (its uppercased resource prefix), so two limiters
 * sharing a backing store still keep independent counters per user.
 */
export interface BucketStore {
  /**
   * Atomically increment the counter for `(namespace, key)`. If no
   * window is currently open for that bucket, install a fresh one
   * with TTL `windowMs` starting at `now`. Returns the new count
   * and the wall-clock reset time.
   */
  increment(
    namespace: string,
    key: string,
    windowMs: number,
    now: number,
  ): Promise<BucketIncrementResult>;

  /** Wipe every bucket in `namespace`. Used by `__resetStateForTests`. */
  reset(namespace: string): Promise<void>;

  /**
   * Read the current bucket for `(namespace, key)` without
   * incrementing. Returns `null` if the bucket has never been hit
   * or its window has already elapsed at `now`.
   *
   * Added for non-bucketing limiters (e.g. the signup-assistant
   * daily circuit breaker) that need to display the live count on
   * an admin metrics card without burning a hit.
   */
  peek(
    namespace: string,
    key: string,
    now: number,
  ): Promise<BucketIncrementResult | null>;

  /**
   * Count buckets in `namespace` whose window has not yet elapsed
   * at `now`. Used by the signup-assistant admin readout (active
   * IP count). Cheap on the in-process store (single map walk);
   * on Redis runs `SCAN MATCH <prefix>:<namespace>:*`, which is
   * fine for occasional admin reads.
   */
  countActive(namespace: string, now: number): Promise<number>;
}

// --------------------------------------------------------------------
// MemoryBucketStore
// --------------------------------------------------------------------

interface MemoryBucketEntry {
  count: number;
  resetAt: number;
}

// Cap the number of buckets a single in-process store holds so a
// flood of unique session/IP keys can't grow the map without bound.
// When we exceed this we evict expired entries first, then drop the
// entries with the soonest reset (most likely already-cooled keys
// near the end of their window). 10k matches the prior per-limiter
// cap; with N limiters sharing one store the practical headroom is
// the same order of magnitude.
const MEMORY_MAX_BUCKETS = 10_000;

export class MemoryBucketStore implements BucketStore {
  // Single flat map keyed `${namespace}:${key}` so eviction and
  // size-tracking are O(map size) regardless of how many limiters
  // share the store. Namespacing keeps two limiters' counters
  // independent even though they share storage.
  private readonly buckets = new Map<string, MemoryBucketEntry>();

  async increment(
    namespace: string,
    key: string,
    windowMs: number,
    now: number,
  ): Promise<BucketIncrementResult> {
    this.evictIfNeeded(now);
    const fullKey = `${namespace}:${key}`;
    const entry = this.buckets.get(fullKey);
    if (!entry || entry.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(fullKey, fresh);
      return { count: 1, resetAt: fresh.resetAt };
    }
    entry.count += 1;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  async reset(namespace: string): Promise<void> {
    const prefix = `${namespace}:`;
    for (const k of this.buckets.keys()) {
      if (k.startsWith(prefix)) this.buckets.delete(k);
    }
  }

  async peek(
    namespace: string,
    key: string,
    now: number,
  ): Promise<BucketIncrementResult | null> {
    const fullKey = `${namespace}:${key}`;
    const entry = this.buckets.get(fullKey);
    if (!entry) return null;
    if (entry.resetAt <= now) {
      // Lazily evict expired entries on read so peek always
      // reports "live" state, the same way `increment` does.
      this.buckets.delete(fullKey);
      return null;
    }
    return { count: entry.count, resetAt: entry.resetAt };
  }

  async countActive(namespace: string, now: number): Promise<number> {
    const prefix = `${namespace}:`;
    let active = 0;
    for (const [k, entry] of this.buckets) {
      if (!k.startsWith(prefix)) continue;
      if (entry.resetAt > now) active += 1;
    }
    return active;
  }

  /** Test-only: wipe every namespace. */
  resetAll(): void {
    this.buckets.clear();
  }

  /** Test-only: current bucket count across all namespaces. */
  size(): number {
    return this.buckets.size;
  }

  private evictIfNeeded(now: number): void {
    if (this.buckets.size <= MEMORY_MAX_BUCKETS) return;
    for (const [k, entry] of this.buckets) {
      if (entry.resetAt <= now) this.buckets.delete(k);
    }
    if (this.buckets.size <= MEMORY_MAX_BUCKETS) return;
    const sorted = Array.from(this.buckets.entries()).sort(
      (a, b) => a[1].resetAt - b[1].resetAt,
    );
    const toDrop = sorted.slice(0, this.buckets.size - MEMORY_MAX_BUCKETS);
    for (const [k] of toDrop) this.buckets.delete(k);
  }
}

// --------------------------------------------------------------------
// RedisBucketStore
// --------------------------------------------------------------------

// Minimal interface we need from the Redis client. Typed against
// `ioredis` but kept as a structural interface so tests can stub it
// without pulling ioredis into the test bundle.
export interface RedisLikeClient {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  scan(
    cursor: string,
    matchKeyword: "MATCH",
    pattern: string,
    countKeyword: "COUNT",
    count: number,
  ): Promise<[string, string[]]>;
  /**
   * Single-key GET — used by `peek` so the admin readout can show
   * the live count for a bucket without burning a hit. Returns the
   * stored counter as a string (Redis convention) or `null` if the
   * key does not exist or has already expired.
   */
  get(key: string): Promise<string | null>;
  /**
   * Per-key remaining TTL in milliseconds. Returns `-2` when the
   * key does not exist and `-1` when the key exists but has no TTL.
   * Used together with `get` to derive `resetAt` for `peek`.
   */
  pttl(key: string): Promise<number>;
  quit?(): Promise<unknown>;
}

// Atomic fixed-window INCR. KEYS[1] is the bucket key. ARGV[1] is
// the window length in milliseconds.
//
//   INCR -> if this is the first hit of a new window, set TTL.
//   PTTL -> read the remaining TTL (in ms) so the caller can compute
//           `resetAt = now + ttl`.
//
// We refresh the TTL whenever PTTL returns < 0 (no TTL set: either
// a fresh INCR or an entry that somehow lost its TTL — Redis 2.x
// behaviour). This means the window tracks the FIRST hit, not the
// last, which is exactly the fixed-window semantics the in-memory
// store has always provided.
const INCREMENT_LUA = `
local current = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

export class RedisBucketStore implements BucketStore {
  constructor(
    private readonly client: RedisLikeClient,
    private readonly keyPrefix: string,
  ) {}

  async increment(
    namespace: string,
    key: string,
    windowMs: number,
    now: number,
  ): Promise<BucketIncrementResult> {
    const fullKey = `${this.keyPrefix}${namespace}:${key}`;
    const result = (await this.client.eval(
      INCREMENT_LUA,
      1,
      fullKey,
      windowMs,
    )) as [number | string, number | string];
    const count = Number(result[0]);
    const ttlMs = Number(result[1]);
    const safeTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : windowMs;
    return { count, resetAt: now + safeTtl };
  }

  async reset(namespace: string): Promise<void> {
    const pattern = `${this.keyPrefix}${namespace}:*`;
    let cursor = "0";
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
      cursor = next;
    } while (cursor !== "0");
  }

  async peek(
    namespace: string,
    key: string,
    now: number,
  ): Promise<BucketIncrementResult | null> {
    const fullKey = `${this.keyPrefix}${namespace}:${key}`;
    const raw = await this.client.get(fullKey);
    if (raw === null || raw === undefined) return null;
    const count = Number(raw);
    if (!Number.isFinite(count) || count <= 0) return null;
    const ttlMs = await this.client.pttl(fullKey);
    // PTTL returns -2 for "no key" (race with expiration) and -1
    // for "no TTL set" — both shouldn't happen for our keys, but
    // be defensive: treat them as "already gone".
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return null;
    return { count, resetAt: now + ttlMs };
  }

  async countActive(namespace: string, _now: number): Promise<number> {
    const pattern = `${this.keyPrefix}${namespace}:*`;
    let cursor = "0";
    let active = 0;
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
      // SCAN only returns keys that haven't been lazily evicted by
      // Redis yet. Expired keys are removed on access or during
      // background expiration, so this is at-most a slight
      // over-count for a few hundred ms after expiry — acceptable
      // for an admin readout.
      active += keys.length;
      cursor = next;
    } while (cursor !== "0");
    return active;
  }
}

// --------------------------------------------------------------------
// Default-store resolver
// --------------------------------------------------------------------

let defaultStore: BucketStore | null = null;
let resolvedStoreKind: "memory" | "redis" | null = null;
let resolvedStorePrefix: string | null = null;

/**
 * Resolve the process-wide default bucket store. Lazy so tests that
 * never touch a limiter don't spin up Redis, and so env vars set by
 * the test runner take effect on first use.
 *
 * Resolution rules:
 *   • If `RATE_LIMIT_REDIS_URL` (preferred) or `REDIS_URL` is set,
 *     dynamically import `ioredis`, connect, and return a
 *     `RedisBucketStore`. Falls back to `MemoryBucketStore` if the
 *     dynamic import or the connection setup throws — limiters must
 *     stay functional even if the shared store is misconfigured.
 *   • Otherwise return a `MemoryBucketStore`.
 *
 * The fallback path logs a warning so a misconfigured deploy is
 * visible in the operator dashboard — silent fall-through to
 * per-replica counters is exactly the regression Task #700 exists to
 * prevent.
 */
export function getDefaultBucketStore(): BucketStore {
  if (defaultStore) return defaultStore;
  const url =
    process.env.RATE_LIMIT_REDIS_URL ||
    process.env.REDIS_URL ||
    "";
  if (!url) {
    defaultStore = new MemoryBucketStore();
    resolvedStoreKind = "memory";
    resolvedStorePrefix = null;
    return defaultStore;
  }
  try {
    // Dynamic require so the ioredis dependency is only loaded when
    // a Redis URL is actually configured. Keeps test/dev startup
    // fast and avoids a hard crash if ioredis is somehow absent
    // from the install (e.g. devDependencies pruned in production).
    const ioredis = nodeRequire("ioredis");
    const Redis = ioredis.default ?? ioredis;
    const client = new Redis(url, {
      // Lazy connect so a transient DNS hiccup at boot doesn't
      // crash the process; the first real `eval` call will
      // surface any persistent connection issue as a 500 on the
      // route, which we'd rather see than a silent fall-through
      // to in-process counters.
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    client.on("error", (err: unknown) => {
      logger.error(
        { kind: "rate_limit.redis.error", err },
        "rate-limit Redis client emitted error",
      );
    });
    const prefix = process.env.RATE_LIMIT_KEY_PREFIX ?? "vndrly:rl:";
    defaultStore = new RedisBucketStore(client, prefix);
    resolvedStoreKind = "redis";
    resolvedStorePrefix = prefix;
    logger.info(
      { kind: "rate_limit.store.resolved", store: "redis", prefix },
      "rate-limit factory using Redis bucket store",
    );
    return defaultStore;
  } catch (err) {
    logger.error(
      { kind: "rate_limit.store.fallback", err },
      "failed to initialise Redis bucket store; falling back to in-process map (per-replica counters)",
    );
    defaultStore = new MemoryBucketStore();
    resolvedStoreKind = "memory";
    resolvedStorePrefix = null;
    return defaultStore;
  }
}

/** Test-only: which backend the default resolver landed on. */
export function getResolvedDefaultStoreKind(): "memory" | "redis" | null {
  return resolvedStoreKind;
}

/**
 * Snapshot of the default bucket store's resolved configuration for
 * the admin dashboard (Task #700 follow-up #776). Triggers
 * resolution on first call so the readout reflects the same backend
 * the limiters use, not a pre-resolution null. Returns:
 *   • `kind` — `"memory"` when no shared store is configured
 *     (per-replica counters), `"redis"` when the Redis-backed shared
 *     store is in use (counters accurate across replicas).
 *   • `prefix` — Redis key prefix (only meaningful when `kind ===
 *     "redis"`); `null` for memory.
 *
 * The shape is stable JSON so it can be embedded in the admin
 * rate-limit-budgets payload without versioning.
 */
export function getResolvedDefaultStoreInfo(): {
  kind: "memory" | "redis";
  prefix: string | null;
} {
  // Force resolution so the dashboard sees the same store the
  // limiters will actually use on first hit.
  getDefaultBucketStore();
  // Resolution always sets these — non-null after the call above.
  return {
    kind: resolvedStoreKind ?? "memory",
    prefix: resolvedStorePrefix,
  };
}

/**
 * Test-only: reset the cached default store so a subsequent
 * `getDefaultBucketStore()` re-reads env vars. Required because the
 * resolver memoises by design.
 */
export function __resetDefaultBucketStoreForTests(): void {
  defaultStore = null;
  resolvedStoreKind = null;
  resolvedStorePrefix = null;
}
