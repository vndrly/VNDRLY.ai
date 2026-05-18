import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryBucketStore,
  RedisBucketStore,
  __resetDefaultBucketStoreForTests,
  getDefaultBucketStore,
  getResolvedDefaultStoreInfo,
  getResolvedDefaultStoreKind,
  type RedisLikeClient,
} from "./bucket-store";

// Helper that fills in the never-called methods of the structural
// `RedisLikeClient` so each test only has to override what it
// actually exercises. Keeps the fakes terse and signals intent at
// the call site (the `eval`/`scan`/`get`/`pttl` overrides each test
// passes are exactly the operations under test).
function fakeRedis(over: Partial<RedisLikeClient> = {}): RedisLikeClient {
  return {
    eval: async () => {
      throw new Error("fakeRedis.eval not stubbed");
    },
    del: async () => 0,
    scan: async () => ["0", []],
    get: async () => null,
    pttl: async () => -2,
    ...over,
  };
}

// Coverage for the pluggable bucket-store backends introduced in
// Task #700. The factory's behavioural matrix lives in
// `rate-limit-factory.test.ts`; this file exercises the storage
// contract — atomicity, namespacing, eviction, and Redis Lua-script
// wiring — that the factory leans on for cross-replica counter
// accuracy.

describe("MemoryBucketStore", () => {
  it("opens a fresh window on first hit and increments within it", async () => {
    const store = new MemoryBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const a = await store.increment("WIDGET", "u:1", 10_000, t);
    expect(a).toEqual({ count: 1, resetAt: t + 10_000 });
    const b = await store.increment("WIDGET", "u:1", 10_000, t + 100);
    expect(b).toEqual({ count: 2, resetAt: t + 10_000 });
  });

  it("rolls the window once the previous reset time has passed", async () => {
    const store = new MemoryBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await store.increment("WIDGET", "u:1", 10_000, t);
    await store.increment("WIDGET", "u:1", 10_000, t + 100);
    // Advance past the reset; the next call must start a brand-new
    // window with count = 1.
    const next = await store.increment("WIDGET", "u:1", 10_000, t + 10_001);
    expect(next).toEqual({ count: 1, resetAt: t + 10_001 + 10_000 });
  });

  it("partitions counters per namespace even for the same key", async () => {
    // The factory passes its uppercased resource prefix as the
    // namespace, so two limiters sharing one store still get
    // independent counters.
    const store = new MemoryBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const a = await store.increment("ALPHA", "u:1", 10_000, t);
    const b = await store.increment("BETA", "u:1", 10_000, t);
    expect(a.count).toBe(1);
    expect(b.count).toBe(1);
    const a2 = await store.increment("ALPHA", "u:1", 10_000, t);
    expect(a2.count).toBe(2);
    const b2 = await store.increment("BETA", "u:1", 10_000, t);
    expect(b2.count).toBe(2);
  });

  it("reset(namespace) wipes only that namespace's buckets", async () => {
    const store = new MemoryBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await store.increment("ALPHA", "u:1", 10_000, t);
    await store.increment("ALPHA", "u:2", 10_000, t);
    await store.increment("BETA", "u:1", 10_000, t);
    expect(store.size()).toBe(3);
    await store.reset("ALPHA");
    expect(store.size()).toBe(1);
    // BETA bucket survived.
    const beta = await store.increment("BETA", "u:1", 10_000, t);
    expect(beta.count).toBe(2);
    // ALPHA started over.
    const alpha = await store.increment("ALPHA", "u:1", 10_000, t);
    expect(alpha.count).toBe(1);
  });
});

describe("RedisBucketStore", () => {
  it("invokes the INCR + PEXPIRE Lua script with the prefixed key and TTL", async () => {
    const calls: Array<{
      script: string;
      numKeys: number;
      args: (string | number)[];
    }> = [];
    const fakeClient = fakeRedis({
      eval: async (
        script: string,
        numKeys: number,
        ...args: (string | number)[]
      ) => {
        calls.push({ script, numKeys, args });
        // Pretend the key is brand-new: count = 1, ttl = windowMs
        // (typed back from the Lua script as numbers).
        return [1, Number(args[1])];
      },
    });
    const store = new RedisBucketStore(fakeClient, "vndrly:rl:");
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const result = await store.increment("WIDGET", "u:1", 10_000, t);
    expect(result).toEqual({ count: 1, resetAt: t + 10_000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].numKeys).toBe(1);
    // Prefix + namespace + key, with the windowMs as the only ARGV.
    expect(calls[0].args).toEqual(["vndrly:rl:WIDGET:u:1", 10_000]);
    // The script must perform the increment server-side so the
    // count++ and TTL install happen atomically across replicas.
    expect(calls[0].script).toMatch(/INCR/);
    expect(calls[0].script).toMatch(/PEXPIRE/);
  });

  it("derives resetAt from the live PTTL returned by the Lua script", async () => {
    // Simulates a hit landing 3,000 ms into an already-running
    // 10s window: PTTL would be 7,000, so the resetAt the store
    // reports must be `now + 7000`, not `now + windowMs`.
    const fakeClient = fakeRedis({
      eval: async () => [4, 7_000],
    });
    const store = new RedisBucketStore(fakeClient, "vndrly:rl:");
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const result = await store.increment("WIDGET", "u:1", 10_000, t);
    expect(result.count).toBe(4);
    expect(result.resetAt).toBe(t + 7_000);
  });

  it("falls back to windowMs when PTTL returns a non-positive value", async () => {
    // Defensive: if Redis returned -1 (no TTL) or -2 (key missing),
    // treat the window as freshly installed for `windowMs` so the
    // limiter doesn't compute a negative `retryAfterMs`.
    const fakeClient = fakeRedis({ eval: async () => [1, -1] });
    const store = new RedisBucketStore(fakeClient, "vndrly:rl:");
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const result = await store.increment("WIDGET", "u:1", 10_000, t);
    expect(result.resetAt).toBe(t + 10_000);
  });

  it("reset(namespace) SCANs the matching prefix and DELs the keys", async () => {
    const seen: string[][] = [];
    const fakeClient = fakeRedis({
      del: async (...keys: string[]) => {
        seen.push(keys);
        return keys.length;
      },
      scan: async (cursor) => {
        // Return everything in one batch then stop (cursor "0").
        if (cursor === "0") {
          return [
            "0",
            ["vndrly:rl:WIDGET:u:1", "vndrly:rl:WIDGET:u:2"],
          ] as [string, string[]];
        }
        return ["0", []] as [string, string[]];
      },
    });
    const store = new RedisBucketStore(fakeClient, "vndrly:rl:");
    await store.reset("WIDGET");
    expect(seen).toEqual([
      ["vndrly:rl:WIDGET:u:1", "vndrly:rl:WIDGET:u:2"],
    ]);
  });

  it("peek(namespace, key) returns count + resetAt without burning a hit", async () => {
    // Coverage for the read-only peek used by the signup-assistant
    // admin readout (Task #700 follow-up #777). Must combine GET +
    // PTTL into a single observable result and never INCR.
    const calls: string[] = [];
    const fakeClient = fakeRedis({
      get: async (key: string) => {
        calls.push(`GET ${key}`);
        return "42";
      },
      pttl: async (key: string) => {
        calls.push(`PTTL ${key}`);
        return 5_000;
      },
      eval: async () => {
        throw new Error("peek must not invoke the INCR Lua script");
      },
    });
    const store = new RedisBucketStore(fakeClient, "vndrly:rl:");
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const result = await store.peek("DAILY", "2026-04-27", t);
    expect(result).toEqual({ count: 42, resetAt: t + 5_000 });
    expect(calls).toEqual([
      "GET vndrly:rl:DAILY:2026-04-27",
      "PTTL vndrly:rl:DAILY:2026-04-27",
    ]);
  });

  it("peek returns null when the key is missing or already expired", async () => {
    const missing = new RedisBucketStore(
      fakeRedis({ get: async () => null }),
      "vndrly:rl:",
    );
    expect(await missing.peek("DAILY", "2026-04-27", 0)).toBeNull();

    // Race: GET returns a count but PTTL says the key is already
    // gone (-2). Treat as expired.
    const racy = new RedisBucketStore(
      fakeRedis({
        get: async () => "5",
        pttl: async () => -2,
      }),
      "vndrly:rl:",
    );
    expect(await racy.peek("DAILY", "2026-04-27", 0)).toBeNull();
  });

  it("countActive(namespace) SCANs the namespace and returns the live key count", async () => {
    // Two SCAN batches, then cursor "0". Verifies pagination is
    // honoured rather than only reading the first page (which would
    // under-count once a deploy has more than COUNT keys per
    // namespace).
    let pages = 0;
    const fakeClient = fakeRedis({
      scan: async (cursor) => {
        pages += 1;
        if (cursor === "0") {
          return ["7", ["vndrly:rl:IPS:1.1.1.1", "vndrly:rl:IPS:2.2.2.2"]] as [
            string,
            string[],
          ];
        }
        return ["0", ["vndrly:rl:IPS:3.3.3.3"]] as [string, string[]];
      },
    });
    const store = new RedisBucketStore(fakeClient, "vndrly:rl:");
    const active = await store.countActive("IPS", Date.now());
    expect(active).toBe(3);
    expect(pages).toBe(2);
  });
});

describe("MemoryBucketStore — peek + countActive", () => {
  it("peek returns the live entry and null after the window elapses", async () => {
    const store = new MemoryBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    expect(await store.peek("DAILY", "2026-04-27", t)).toBeNull();
    await store.increment("DAILY", "2026-04-27", 10_000, t);
    await store.increment("DAILY", "2026-04-27", 10_000, t + 1);
    const live = await store.peek("DAILY", "2026-04-27", t + 100);
    expect(live).toEqual({ count: 2, resetAt: t + 10_000 });
    // After the window, peek must report null AND quietly evict the
    // entry so the map doesn't grow unbounded with stale buckets.
    expect(await store.peek("DAILY", "2026-04-27", t + 10_001)).toBeNull();
  });

  it("countActive(namespace) ignores other namespaces and expired entries", async () => {
    const store = new MemoryBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await store.increment("IPS", "1.1.1.1", 10_000, t);
    await store.increment("IPS", "2.2.2.2", 10_000, t);
    await store.increment("OTHER", "1.1.1.1", 10_000, t);
    expect(await store.countActive("IPS", t + 100)).toBe(2);
    expect(await store.countActive("OTHER", t + 100)).toBe(1);
    // Past the window: nothing active.
    expect(await store.countActive("IPS", t + 10_001)).toBe(0);
  });
});

describe("getDefaultBucketStore", () => {
  beforeEach(() => {
    __resetDefaultBucketStoreForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __resetDefaultBucketStoreForTests();
  });

  it("returns an in-process MemoryBucketStore when no Redis URL is configured", () => {
    vi.stubEnv("RATE_LIMIT_REDIS_URL", "");
    vi.stubEnv("REDIS_URL", "");
    const store = getDefaultBucketStore();
    expect(store).toBeInstanceOf(MemoryBucketStore);
    expect(getResolvedDefaultStoreKind()).toBe("memory");
  });

  it("memoises the resolved store across calls", () => {
    const a = getDefaultBucketStore();
    const b = getDefaultBucketStore();
    // Same instance — limiters share a single backing store so
    // counters stay consistent across the API process.
    expect(a).toBe(b);
  });

  it("getResolvedDefaultStoreInfo reports the active backend kind + prefix", () => {
    // Memory: no shared store, no prefix. The admin readout should
    // say "memory" / null so operators know counters are
    // per-replica.
    vi.stubEnv("RATE_LIMIT_REDIS_URL", "");
    vi.stubEnv("REDIS_URL", "");
    expect(getResolvedDefaultStoreInfo()).toEqual({
      kind: "memory",
      prefix: null,
    });
  });
});
