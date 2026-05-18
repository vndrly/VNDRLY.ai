import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { RedisBucketStore } from "./bucket-store";

// Real-Redis integration coverage for `RedisBucketStore`
// (Task #700 follow-up #775). The unit tests in
// `bucket-store.test.ts` use a hand-rolled `RedisLikeClient` fake
// and therefore can't catch:
//
//   • The Lua INCR+PEXPIRE+PTTL script not running atomically
//     against a live server (e.g. argument-encoding bugs that only
//     surface when ioredis actually serialises the call).
//   • Two limiter instances pointed at the same key disagreeing on
//     the count — which is the property that makes the shared
//     backing store useful when the API is scaled across replicas.
//   • SCAN-based reset / countActive missing keys after the cursor
//     wraps in a populated keyspace.
//
// This file is opt-in: it only runs when `REDIS_TEST_URL` is set
// (e.g. against a local docker-compose Redis or a CI side-car).
// In normal `pnpm test` runs every case is skipped so contributors
// without Redis on hand aren't blocked. CI can flip the switch by
// exporting `REDIS_TEST_URL=redis://localhost:6379/15` in the
// dedicated rate-limit job.

const REDIS_URL = process.env.REDIS_TEST_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis("RedisBucketStore against a real Redis (REDIS_TEST_URL)", () => {
  // Use a unique prefix per test run so parallel CI jobs (or a
  // developer running this twice in quick succession) cannot stomp
  // on each other's keys.
  const PREFIX = `vndrly:rl:test:${process.pid}:${Date.now()}:`;
  let clientA: Redis;
  let clientB: Redis;
  let storeA: RedisBucketStore;
  let storeB: RedisBucketStore;

  beforeAll(async () => {
    // Two independent connections — one per "replica" — so the
    // cross-replica counter agreement test below is exercising real
    // network round-trips, not a single shared TCP socket that
    // happens to round-trip into itself.
    clientA = new Redis(REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    clientB = new Redis(REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await clientA.connect();
    await clientB.connect();
    storeA = new RedisBucketStore(clientA, PREFIX);
    storeB = new RedisBucketStore(clientB, PREFIX);
  });

  afterAll(async () => {
    // Best-effort cleanup of every key this run created so we don't
    // pollute the target Redis between runs. Failures here are
    // non-fatal — we still want the connections closed.
    try {
      await storeA.reset("INC");
      await storeA.reset("AGREE");
      await storeA.reset("ATOMIC");
      await storeA.reset("ISO_A");
      await storeA.reset("ISO_B");
      await storeA.reset("PEEK");
      await storeA.reset("EXP");
      await storeA.reset("COUNT");
    } catch {
      // ignore
    }
    await clientA.quit();
    await clientB.quit();
  });

  it("INCR+PEXPIRE land atomically and resetAt tracks the live PTTL", async () => {
    const t0 = Date.now();
    const r1 = await storeA.increment("INC", "k1", 30_000, t0);
    expect(r1.count).toBe(1);
    expect(r1.resetAt).toBeGreaterThan(t0);
    expect(r1.resetAt - t0).toBeLessThanOrEqual(30_000);

    // A second hit during the live window must increment, not reset
    // the TTL — Redis Lua makes this atomic, so even a millisecond
    // race between two replicas can't double-install the bucket.
    const r2 = await storeA.increment("INC", "k1", 30_000, t0 + 5);
    expect(r2.count).toBe(2);
    expect(r2.resetAt).toBeLessThanOrEqual(r1.resetAt + 50);
  });

  it("two RedisBucketStore instances on the same key see one shared counter", async () => {
    // The whole reason this store exists: scaled-out API replicas
    // must observe the same count for the same key. If this check
    // ever fails we've regressed Task #700's primary goal.
    const now = Date.now();
    const a1 = await storeA.increment("AGREE", "shared", 60_000, now);
    expect(a1.count).toBe(1);
    const b1 = await storeB.increment("AGREE", "shared", 60_000, now + 1);
    expect(b1.count).toBe(2);
    const a2 = await storeA.increment("AGREE", "shared", 60_000, now + 2);
    expect(a2.count).toBe(3);

    // Replica B's view of the key must also report count=3 via peek
    // — confirming the read path (GET+PTTL) sees the same state as
    // the write path (Lua INCR).
    const peeked = await storeB.peek("AGREE", "shared", now + 3);
    expect(peeked?.count).toBe(3);
  });

  it("namespaces are isolated: hits in NS A do not leak into NS B", async () => {
    const now = Date.now();
    await storeA.increment("ISO_A", "key", 60_000, now);
    await storeA.increment("ISO_A", "key", 60_000, now);
    await storeA.increment("ISO_A", "key", 60_000, now);
    const aPeek = await storeA.peek("ISO_A", "key", now);
    const bPeek = await storeA.peek("ISO_B", "key", now);
    expect(aPeek?.count).toBe(3);
    // ISO_B was never touched — must read as null, not "0" and not
    // accidentally share the ISO_A bucket because of a prefix bug.
    expect(bPeek).toBeNull();
  });

  it("issues atomic increments under concurrent fire (no lost updates)", async () => {
    // Cross-replica atomicity is the whole point of the Lua script.
    // Fan out N parallel increments across BOTH clients on the same
    // key — if the script weren't atomic we'd see duplicate counts
    // or a final count < N here.
    const now = Date.now();
    const N = 100;
    const calls: Promise<{ count: number }>[] = [];
    for (let i = 0; i < N; i++) {
      const store = i % 2 === 0 ? storeA : storeB;
      calls.push(store.increment("ATOMIC", "hot", 30_000, now));
    }
    const results = await Promise.all(calls);
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    // Every count from 1..N must appear exactly once across both
    // replicas. Lost updates would leave gaps; a non-atomic
    // increment would produce duplicates.
    expect(counts).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it("peek returns the live entry from a different client without burning a hit", async () => {
    const now = Date.now();
    await storeA.increment("PEEK", "u:1", 60_000, now);
    await storeA.increment("PEEK", "u:1", 60_000, now);
    const peeked = await storeB.peek("PEEK", "u:1", now);
    expect(peeked?.count).toBe(2);
    expect(peeked!.resetAt).toBeGreaterThan(now);
    // peek must NOT have incremented — the next real hit lands at 3.
    const after = await storeA.increment("PEEK", "u:1", 60_000, now);
    expect(after.count).toBe(3);
  });

  it("PEXPIRE installs a real TTL — the bucket actually expires", async () => {
    // Short window so the test is fast. 600 ms is long enough to
    // absorb network latency but short enough not to slow CI.
    const windowMs = 600;
    const t0 = Date.now();
    const first = await storeA.increment("EXP", "u:1", windowMs, t0);
    expect(first.count).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, windowMs + 400));
    // After expiry the key must be gone from both replicas' view.
    expect(await storeB.peek("EXP", "u:1", Date.now())).toBeNull();
    // And the next increment opens a fresh window at count = 1.
    const next = await storeA.increment("EXP", "u:1", windowMs, Date.now());
    expect(next.count).toBe(1);
  });

  it("countActive(namespace) reflects live keys via SCAN paging", async () => {
    const now = Date.now();
    // Populate enough keys to encourage SCAN to page (the
    // `RedisBucketStore` impl uses COUNT 200 by default; even a
    // smaller seed is fine for correctness — the test guards the
    // pagination loop, not a specific page size).
    for (let i = 0; i < 25; i++) {
      await storeA.increment("COUNT", `k:${i}`, 60_000, now);
    }
    const active = await storeA.countActive("COUNT", now);
    expect(active).toBe(25);

    // After reset the namespace is empty again.
    await storeA.reset("COUNT");
    expect(await storeA.countActive("COUNT", now)).toBe(0);
  });
});
