import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  PostgresBucketStore,
  __resetSignupAssistantPgStoreForTests,
  getSignupAssistantPgStore,
} from "./signup-assistant-pg-store";

// Integration coverage for the Postgres-backed bucket store that
// powers signup-assistant abuse controls (Task #488). The
// in-process unit tests in `signup-assistant-rate-limit.test.ts`
// inject a `MemoryBucketStore`, which can't catch the two properties
// that motivate this store's existence:
//
//   • Counts survive a "process restart" — modelled here by
//     constructing a second `PostgresBucketStore` instance and
//     reading the row the first instance wrote. With the in-memory
//     store the second instance would start at zero.
//   • Two stores hitting the same `(namespace, key)` agree on the
//     count — the cross-replica property the upsert delivers via
//     row-level locking.
//
// Runs against the isolated test DB provisioned by
// `scripts/run-with-test-db.ts`, so it is safe under `pnpm test`
// and never touches dev data.

beforeEach(async () => {
  // Truncate so each test sees a known-empty table. The integration
  // tests below run sequentially against a single test DB.
  await db.execute(sql`TRUNCATE TABLE signup_assistant_counters`);
  __resetSignupAssistantPgStoreForTests();
});

afterEach(async () => {
  __resetSignupAssistantPgStoreForTests();
});

describe("PostgresBucketStore.increment", () => {
  it("opens a fresh window on first hit and increments within it", async () => {
    const store = new PostgresBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const a = await store.increment("WIDGET", "u:1", 10_000, t);
    expect(a.count).toBe(1);
    expect(a.resetAt).toBe(t + 10_000);

    const b = await store.increment("WIDGET", "u:1", 10_000, t + 100);
    expect(b.count).toBe(2);
    // resetAt must NOT advance — fixed-window semantics track the
    // first hit, not the latest.
    expect(b.resetAt).toBe(t + 10_000);
  });

  it("rolls the window once the previous reset time has passed", async () => {
    const store = new PostgresBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await store.increment("WIDGET", "u:1", 10_000, t);
    await store.increment("WIDGET", "u:1", 10_000, t + 100);

    // Cross the reset boundary — the next hit must start a brand-new
    // window with count = 1 and a fresh resetAt anchored at the new
    // `now`.
    const next = await store.increment("WIDGET", "u:1", 10_000, t + 10_001);
    expect(next.count).toBe(1);
    expect(next.resetAt).toBe(t + 10_001 + 10_000);
  });

  it("partitions counters per namespace even for the same key", async () => {
    const store = new PostgresBucketStore();
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
});

describe("PostgresBucketStore persistence (the property the task fixes)", () => {
  it("a second store instance reads the first instance's count", async () => {
    // Models the "process restart" scenario: the first store writes
    // a hit, then we throw it away and construct a fresh
    // `PostgresBucketStore`. The new instance — which has zero
    // in-memory state — must continue counting from where the
    // previous one left off, because the count lives in Postgres.
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const before = new PostgresBucketStore();
    const a = await before.increment("DAILY", "2026-04-27", 36 * 60 * 60 * 1000, t);
    expect(a.count).toBe(1);

    // Simulate restart: discard `before`, build a brand-new store.
    const after = new PostgresBucketStore();
    const b = await after.increment("DAILY", "2026-04-27", 36 * 60 * 60 * 1000, t + 1_000);
    expect(b.count).toBe(2);
    // resetAt sticks to the original window — restarting does not
    // re-anchor the daily bucket.
    expect(b.resetAt).toBe(a.resetAt);
  });

  it("two concurrent stores writing the same key agree on the count", async () => {
    // Models two API replicas hammering the same IP at the same
    // instant. Postgres serialises the upserts via the composite PK,
    // so the final count must equal the total number of increments
    // — never less (the cross-replica regression the task prevents).
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const replicaA = new PostgresBucketStore();
    const replicaB = new PostgresBucketStore();
    const promises = [
      replicaA.increment("IP", "203.0.113.99", 10_000, t),
      replicaB.increment("IP", "203.0.113.99", 10_000, t),
      replicaA.increment("IP", "203.0.113.99", 10_000, t + 1),
      replicaB.increment("IP", "203.0.113.99", 10_000, t + 1),
      replicaA.increment("IP", "203.0.113.99", 10_000, t + 2),
    ];
    const results = await Promise.all(promises);
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("PostgresBucketStore.peek", () => {
  it("returns null when the bucket has never been written", async () => {
    const store = new PostgresBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    expect(await store.peek("WIDGET", "missing", t)).toBeNull();
  });

  it("does not consume a hit", async () => {
    // Regression guard for the admin readout: peek MUST be
    // non-incrementing so polling the dashboard cannot itself burn
    // budget.
    const store = new PostgresBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await store.increment("DAILY", "2026-04-27", 60_000, t);
    for (let i = 0; i < 5; i++) await store.peek("DAILY", "2026-04-27", t);
    const after = await store.increment("DAILY", "2026-04-27", 60_000, t);
    expect(after.count).toBe(2);
  });

  it("hides elapsed windows", async () => {
    // peek filters on `reset_at > now` so a stale row that hasn't
    // been swept yet still reports as "no live bucket".
    const store = new PostgresBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await store.increment("WIDGET", "u:1", 10_000, t);
    expect(await store.peek("WIDGET", "u:1", t + 10_001)).toBeNull();
  });
});

describe("PostgresBucketStore.countActive", () => {
  it("counts only non-elapsed buckets in the namespace", async () => {
    const store = new PostgresBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await store.increment("IP", "1.1.1.1", 10_000, t);
    await store.increment("IP", "1.1.1.2", 10_000, t);
    // Stale row in the same namespace: opened earlier, already past
    // its reset by the time we call countActive.
    await store.increment("IP", "1.1.1.3", 1_000, t - 5_000);
    // Different-namespace row mustn't bleed in.
    await store.increment("DAILY", "2026-04-27", 10_000, t);

    const n = await store.countActive("IP", t);
    expect(n).toBe(2);
  });
});

describe("PostgresBucketStore.reset", () => {
  it("wipes only the requested namespace", async () => {
    const store = new PostgresBucketStore();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await store.increment("ALPHA", "u:1", 10_000, t);
    await store.increment("ALPHA", "u:2", 10_000, t);
    await store.increment("BETA", "u:1", 10_000, t);
    await store.reset("ALPHA");
    expect(await store.countActive("ALPHA", t)).toBe(0);
    expect(await store.countActive("BETA", t)).toBe(1);
  });
});

describe("getSignupAssistantPgStore (singleton)", () => {
  it("returns the same instance across calls", () => {
    const a = getSignupAssistantPgStore();
    const b = getSignupAssistantPgStore();
    expect(a).toBe(b);
  });

  it("returns a fresh instance after the test reset helper runs", () => {
    const a = getSignupAssistantPgStore();
    __resetSignupAssistantPgStoreForTests();
    const b = getSignupAssistantPgStore();
    expect(a).not.toBe(b);
  });
});
