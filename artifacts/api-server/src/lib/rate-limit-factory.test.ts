import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";
import { createRateLimiter } from "./rate-limit-factory";
import { MemoryBucketStore } from "./bucket-store";

// The factory is the shared substrate behind every per-resource
// limiter introduced in Task #689 (notifications, comments, hotlist).
// We exercise its full behaviour matrix once here so the per-resource
// files can stay thin smoke tests that only verify their env-var
// prefix and `code`/`logKind` strings wired through correctly.
//
// Each test gets its own `MemoryBucketStore` so cases never observe
// counter state from previous tests (the factory's default store is a
// process-wide singleton — Task #700 — so passing an explicit store
// is the test-isolation contract).

function newLimiter(prefix = "WIDGET") {
  return createRateLimiter({
    resourcePrefix: prefix,
    errorCode: `${prefix.toLowerCase()}.rate_limited`,
    logKind: `${prefix.toLowerCase()}.rate_limit.trip`,
    defaultMax: 30,
    defaultWindowMs: 10 * 1000,
    message: `Too many ${prefix.toLowerCase()} requests in a short window. Please slow down and try again shortly.`,
    store: new MemoryBucketStore(),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createRateLimiter — buckets and budgets", () => {
  it("allows up to the configured cap within the window, then blocks", async () => {
    const limiter = newLimiter();
    const key = "u:42";
    const now = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < limiter.CONFIG.max; i++) {
      const result = await limiter.recordHit(key, undefined, now);
      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(limiter.CONFIG.max - (i + 1));
    }
    const blocked = await limiter.recordHit(key, undefined, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(limiter.CONFIG.windowMs);
  });

  it("resets the counter once the window has elapsed", async () => {
    const limiter = newLimiter();
    const key = "u:43";
    const t0 = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < limiter.CONFIG.max; i++) {
      expect((await limiter.recordHit(key, undefined, t0)).ok).toBe(true);
    }
    expect((await limiter.recordHit(key, undefined, t0)).ok).toBe(false);

    const t1 = t0 + limiter.CONFIG.windowMs + 1;
    const afterReset = await limiter.recordHit(key, undefined, t1);
    expect(afterReset.ok).toBe(true);
    expect(afterReset.remaining).toBe(limiter.CONFIG.max - 1);
  });

  it("tracks separate keys independently", async () => {
    const limiter = newLimiter();
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < limiter.CONFIG.max; i++) {
      expect((await limiter.recordHit("u:1", undefined, t)).ok).toBe(true);
    }
    expect((await limiter.recordHit("u:1", undefined, t)).ok).toBe(false);
    expect((await limiter.recordHit("u:2", undefined, t)).ok).toBe(true);
  });

  it("two different limiters keep independent bucket maps", async () => {
    // The whole point of a factory: hammering the comments limiter
    // must not burn through a user's notifications or hotlist
    // budget. Each `createRateLimiter` call is namespaced so its
    // counters stay independent even when they share a store.
    const a = newLimiter("ALPHA");
    const b = newLimiter("BETA");
    const key = "u:cross";
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < a.CONFIG.max; i++) {
      expect((await a.recordHit(key, undefined, t)).ok).toBe(true);
    }
    expect((await a.recordHit(key, undefined, t)).ok).toBe(false);
    // Beta has its own bucket — fully open.
    expect((await b.recordHit(key, undefined, t)).ok).toBe(true);
    expect((await b.recordHit(key, undefined, t)).remaining).toBe(
      b.CONFIG.max - 2,
    );
  });

  it("namespaces are isolated even when two limiters share the same store", async () => {
    // Direct counterpart to the above, but with a SHARED store: a
    // single backing store (e.g. one Redis) must still partition
    // counters by limiter namespace. This is the property that
    // lets the production deploy point every limiter at the same
    // Redis without cross-resource bleed.
    const sharedStore = new MemoryBucketStore();
    const a = createRateLimiter({
      resourcePrefix: "ALPHA",
      errorCode: "alpha.rate_limited",
      logKind: "alpha.rate_limit.trip",
      defaultMax: 2,
      defaultWindowMs: 5_000,
      message: "alpha rate limited",
      store: sharedStore,
    });
    const b = createRateLimiter({
      resourcePrefix: "BETA",
      errorCode: "beta.rate_limited",
      logKind: "beta.rate_limit.trip",
      defaultMax: 2,
      defaultWindowMs: 5_000,
      message: "beta rate limited",
      store: sharedStore,
    });
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    expect((await a.recordHit("u:7", undefined, t)).ok).toBe(true);
    expect((await a.recordHit("u:7", undefined, t)).ok).toBe(true);
    expect((await a.recordHit("u:7", undefined, t)).ok).toBe(false);
    // Beta still has full headroom for the same key.
    expect((await b.recordHit("u:7", undefined, t)).ok).toBe(true);
    expect((await b.recordHit("u:7", undefined, t)).ok).toBe(true);
    expect((await b.recordHit("u:7", undefined, t)).ok).toBe(false);
  });

  it("honours an explicit per-call budget instead of the default", async () => {
    const limiter = newLimiter();
    const key = "u:explicit";
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const budget = { max: 2, windowMs: 5_000 };
    expect((await limiter.recordHit(key, budget, t)).ok).toBe(true);
    expect((await limiter.recordHit(key, budget, t)).ok).toBe(true);
    const blocked = await limiter.recordHit(key, budget, t);
    expect(blocked.ok).toBe(false);
    expect(blocked.limit).toBe(2);
    expect(blocked.windowMs).toBe(5_000);
  });
});

describe("createRateLimiter — env-driven defaults and per-role overrides", () => {
  it("reads the resource-prefixed env var for the global default", () => {
    const limiter = newLimiter("WIDGET");
    vi.stubEnv("WIDGET_RATE_LIMIT_MAX", "7");
    vi.stubEnv("WIDGET_RATE_LIMIT_WINDOW_MS", "12345");
    expect(limiter.CONFIG.max).toBe(7);
    expect(limiter.CONFIG.windowMs).toBe(12345);
  });

  it("isolates env-var lookups per resource prefix", () => {
    // The factory's contract: `WIDGET_RATE_LIMIT_MAX` only
    // influences the WIDGET limiter, not OTHER. Operators rely on
    // this to tune one endpoint without affecting another.
    const widget = newLimiter("WIDGET");
    const other = newLimiter("OTHER");
    vi.stubEnv("WIDGET_RATE_LIMIT_MAX", "5");
    vi.stubEnv("OTHER_RATE_LIMIT_MAX", "9");
    expect(widget.CONFIG.max).toBe(5);
    expect(other.CONFIG.max).toBe(9);
  });

  it("returns the global default for unauthenticated callers", () => {
    const limiter = newLimiter();
    expect(limiter.getBudgetForRole(null)).toEqual({
      max: limiter.CONFIG.max,
      windowMs: limiter.CONFIG.windowMs,
    });
    expect(limiter.getBudgetForRole(undefined)).toEqual({
      max: limiter.CONFIG.max,
      windowMs: limiter.CONFIG.windowMs,
    });
  });

  it("returns the global default for malformed/spoofed role strings", () => {
    const limiter = newLimiter("WIDGET");
    for (const bad of [
      "ADMIN",
      "admin role",
      "admin-role",
      "admin/role",
      "../HOME",
      "",
      "1admin",
      "a".repeat(33),
    ]) {
      expect(limiter.getBudgetForRole(bad)).toEqual({
        max: limiter.CONFIG.max,
        windowMs: limiter.CONFIG.windowMs,
      });
    }
  });

  it("falls back to the global default for a sanitized role with no override set", () => {
    const limiter = newLimiter("WIDGET");
    expect(limiter.getBudgetForRole("dispatcher")).toEqual({
      max: limiter.CONFIG.max,
      windowMs: limiter.CONFIG.windowMs,
    });
  });

  it("picks the per-role max override when the env var is set", () => {
    const limiter = newLimiter("WIDGET");
    vi.stubEnv("WIDGET_RATE_LIMIT_MAX_ADMIN", "120");
    expect(limiter.getBudgetForRole("admin")).toEqual({
      max: 120,
      windowMs: limiter.CONFIG.windowMs,
    });
  });

  it("picks the per-role window override when the env var is set", () => {
    const limiter = newLimiter("WIDGET");
    vi.stubEnv("WIDGET_RATE_LIMIT_WINDOW_MS_VENDOR", "60000");
    expect(limiter.getBudgetForRole("vendor")).toEqual({
      max: limiter.CONFIG.max,
      windowMs: 60_000,
    });
  });

  it("gives different roles different budgets when both are configured", () => {
    const limiter = newLimiter("WIDGET");
    vi.stubEnv("WIDGET_RATE_LIMIT_MAX_ADMIN", "200");
    vi.stubEnv("WIDGET_RATE_LIMIT_MAX_FIELD_EMPLOYEE", "10");
    const admin = limiter.getBudgetForRole("admin");
    const field = limiter.getBudgetForRole("field_employee");
    expect(admin.max).toBe(200);
    expect(field.max).toBe(10);
    expect(admin.max).not.toBe(field.max);
  });

  it("ignores garbage env values and falls back to the global default", () => {
    const limiter = newLimiter("WIDGET");
    for (const bad of ["not-a-number", "0", "-5", "2.5", "Infinity", "NaN"]) {
      vi.stubEnv("WIDGET_RATE_LIMIT_MAX_PARTNER", bad);
      expect(limiter.getBudgetForRole("partner").max).toBe(limiter.CONFIG.max);
    }
  });
});

describe("createRateLimiter — getRateLimitKey", () => {
  function mkReq(
    headers: Record<string, string | string[] | undefined> = {},
    remoteAddress?: string,
  ): Request {
    return {
      headers,
      socket: { remoteAddress } as Request["socket"],
      ip: remoteAddress,
    } as unknown as Request;
  }

  it("prefers the session userId when present", () => {
    const limiter = newLimiter();
    expect(limiter.getRateLimitKey(mkReq(), { userId: 7 })).toBe("u:7");
  });

  it("falls back to the client IP when no session is decoded", () => {
    const limiter = newLimiter();
    const req = mkReq({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(limiter.getRateLimitKey(req, null)).toBe("ip:203.0.113.5");
  });

  it("does not collapse two different sessions onto the same bucket", () => {
    const limiter = newLimiter();
    expect(limiter.getRateLimitKey(mkReq(), { userId: 7 })).not.toBe(
      limiter.getRateLimitKey(mkReq(), { userId: 8 }),
    );
  });
});

describe("createRateLimiter — enforce (role-aware integration)", () => {
  function mkReq(): Request {
    return {
      path: "/api/widget",
      method: "GET",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" } as Request["socket"],
      ip: "127.0.0.1",
    } as unknown as Request;
  }

  function mkRes() {
    const headers: Record<string, string> = {};
    let statusCode: number | null = null;
    let body: unknown = null;
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(payload: unknown) {
        body = payload;
        return res;
      },
    } as unknown as Response;
    return {
      res,
      getHeaders: () => headers,
      getStatus: () => statusCode,
      getBody: () => body,
    };
  }

  it("admins with a larger budget can outlast vendors on the default budget", async () => {
    const limiter = newLimiter("WIDGET");
    vi.stubEnv("WIDGET_RATE_LIMIT_MAX_ADMIN", "5");
    vi.stubEnv("WIDGET_RATE_LIMIT_MAX_VENDOR", "2");

    const adminReq = mkReq();
    const vendorReq = mkReq();
    const adminRes = mkRes();
    const vendorRes = mkRes();

    const admin = { userId: 1, role: "admin" };
    const vendor = { userId: 2, role: "vendor" };

    expect(await limiter.enforce(vendorReq, vendorRes.res, vendor)).toBe(true);
    expect(await limiter.enforce(vendorReq, vendorRes.res, vendor)).toBe(true);
    expect(await limiter.enforce(vendorReq, vendorRes.res, vendor)).toBe(false);
    expect(vendorRes.getStatus()).toBe(429);
    expect(vendorRes.getHeaders()["Retry-After"]).toBeDefined();
    expect(vendorRes.getBody()).toMatchObject({
      code: "widget.rate_limited",
      limit: 2,
    });

    for (let i = 0; i < 5; i++) {
      expect(await limiter.enforce(adminReq, adminRes.res, admin)).toBe(true);
    }
    expect(await limiter.enforce(adminReq, adminRes.res, admin)).toBe(false);
    expect(adminRes.getBody()).toMatchObject({ limit: 5 });
  });

  it("returns 429 with the configured errorCode and message", async () => {
    const limiter = createRateLimiter({
      resourcePrefix: "GADGET",
      errorCode: "gadget.rate_limited",
      logKind: "gadget.rate_limit.trip",
      defaultMax: 1,
      defaultWindowMs: 5_000,
      message: "slow down on the gadgets",
      store: new MemoryBucketStore(),
    });
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 99, role: "vendor" };
    expect(await limiter.enforce(req, res.res, session)).toBe(true);
    expect(await limiter.enforce(req, res.res, session)).toBe(false);
    expect(res.getStatus()).toBe(429);
    expect(res.getBody()).toMatchObject({
      error: "rate_limited",
      code: "gadget.rate_limited",
      message: "slow down on the gadgets",
      limit: 1,
      windowMs: 5_000,
    });
  });

  it("__resetStateForTests clears the bucket between cases", async () => {
    const limiter = newLimiter();
    vi.stubEnv("WIDGET_RATE_LIMIT_MAX", "1");
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 12, role: "vendor" };
    expect(await limiter.enforce(req, res.res, session)).toBe(true);
    expect(await limiter.enforce(req, res.res, session)).toBe(false);
    await limiter.__resetStateForTests();
    const res2 = mkRes();
    expect(await limiter.enforce(req, res2.res, session)).toBe(true);
  });
});

describe("createRateLimiter — recent trips ring buffer (Task #696)", () => {
  // The ring buffer is the data source behind the operations
  // dashboard's "recent rate-limit trips" panel. We exercise it
  // directly through `enforce` (the integration path that the
  // dashboard endpoint reads), rather than poking at internals,
  // so the tests stay valid if the buffer's storage shape changes.

  function mkReq(): Request {
    return {
      path: "/api/widget",
      method: "GET",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" } as Request["socket"],
      ip: "127.0.0.1",
    } as unknown as Request;
  }

  function mkRes(): Response {
    return {
      setHeader() {},
      status() {
        return this;
      },
      json() {
        return this;
      },
    } as unknown as Response;
  }

  function newCappedLimiter(opts?: {
    maxEntries?: number;
    retentionMs?: number;
  }) {
    return createRateLimiter({
      resourcePrefix: "WIDGET",
      errorCode: "widget.rate_limited",
      logKind: "widget.rate_limit.trip",
      defaultMax: 1,
      defaultWindowMs: 60_000,
      message: "slow down",
      store: new MemoryBucketStore(),
      tripsBufferOptions: {
        maxEntries: opts?.maxEntries ?? 1_000,
        retentionMs: opts?.retentionMs ?? 60 * 60 * 1000,
      },
    });
  }

  it("starts empty and reports an empty summary", () => {
    const limiter = newCappedLimiter();
    expect(limiter.getRecentTrips()).toEqual([]);
    const summary = limiter.summarizeRecentTrips({ windowMs: 60_000 });
    expect(summary).toEqual({
      windowMs: 60_000,
      totalTrips: 0,
      uniqueKeys: 0,
      byRole: [],
    });
    expect(limiter.getTripsBufferInfo()).toMatchObject({
      currentSize: 0,
      oldestTrackedAt: null,
    });
  });

  it("records one entry per 429 trip, with the role and key", async () => {
    const limiter = newCappedLimiter();
    // First call allowed; second tripped (max=1).
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    const trips = limiter.getRecentTrips();
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ role: "vendor", key: "u:7" });
    expect(typeof trips[0].ts).toBe("number");
  });

  it("does not record allowed (non-tripped) requests", async () => {
    const limiter = createRateLimiter({
      resourcePrefix: "WIDGET",
      errorCode: "widget.rate_limited",
      logKind: "widget.rate_limit.trip",
      defaultMax: 5,
      defaultWindowMs: 60_000,
      message: "ok",
      store: new MemoryBucketStore(),
    });
    for (let i = 0; i < 5; i++) {
      await limiter.enforce(mkReq(), mkRes(), { userId: 1, role: "admin" });
    }
    expect(limiter.getRecentTrips()).toEqual([]);
  });

  it("captures the role as null for unauthenticated callers", async () => {
    const limiter = newCappedLimiter();
    await limiter.enforce(mkReq(), mkRes(), null);
    await limiter.enforce(mkReq(), mkRes(), null);
    const trips = limiter.getRecentTrips();
    expect(trips).toHaveLength(1);
    expect(trips[0].role).toBeNull();
    expect(trips[0].key).toMatch(/^ip:/);
  });

  it("filters by sinceMs window", async () => {
    const limiter = newCappedLimiter();
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    const trips = limiter.getRecentTrips();
    const ts = trips[0].ts;
    // Asking for a window that ends before the trip happened
    // returns nothing; asking for a window that includes it
    // returns the entry.
    expect(
      limiter.getRecentTrips({ sinceMs: 1, now: ts + 10_000 }),
    ).toEqual([]);
    expect(
      limiter.getRecentTrips({ sinceMs: 60_000, now: ts + 1_000 }),
    ).toHaveLength(1);
  });

  it("evicts entries older than retentionMs on the next call", async () => {
    const limiter = newCappedLimiter({ retentionMs: 1_000 });
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    expect(limiter.getRecentTrips()).toHaveLength(1);
    // Reading past the retention window: lazy prune drops the
    // entry even without a new push.
    const ts = limiter.getTripsBufferInfo().oldestTrackedAt!;
    const future = ts + 10_000;
    expect(limiter.getRecentTrips({ now: future })).toEqual([]);
    expect(limiter.getTripsBufferInfo().currentSize).toBe(0);
  });

  it("evicts FIFO once maxEntries is exceeded", async () => {
    const limiter = newCappedLimiter({ maxEntries: 3 });
    // Each pair of enforce calls produces exactly one trip
    // (max=1). Five pairs ⇒ five trips ⇒ buffer should land at
    // capacity (3) with the two oldest evicted.
    for (let i = 0; i < 5; i++) {
      await limiter.enforce(mkReq(), mkRes(), {
        userId: 100 + i,
        role: "vendor",
      });
      await limiter.enforce(mkReq(), mkRes(), {
        userId: 100 + i,
        role: "vendor",
      });
    }
    const info = limiter.getTripsBufferInfo();
    expect(info.currentSize).toBe(3);
    const trips = limiter.getRecentTrips();
    expect(trips.map((t) => t.key)).toEqual([
      "u:102",
      "u:103",
      "u:104",
    ]);
  });

  it("summarizes by role with trips and unique keys, sorted by trips desc", async () => {
    const limiter = newCappedLimiter();
    // Three vendors trip once each (3 trips, 3 unique keys);
    // one admin trips twice (2 trips, 1 unique key).
    for (const userId of [1, 2, 3]) {
      await limiter.enforce(mkReq(), mkRes(), { userId, role: "vendor" });
      await limiter.enforce(mkReq(), mkRes(), { userId, role: "vendor" });
    }
    for (let i = 0; i < 3; i++) {
      await limiter.enforce(mkReq(), mkRes(), { userId: 99, role: "admin" });
    }
    const summary = limiter.summarizeRecentTrips({ windowMs: 60_000 });
    expect(summary.totalTrips).toBe(5);
    expect(summary.uniqueKeys).toBe(4);
    expect(summary.byRole).toEqual([
      { role: "vendor", trips: 3, uniqueKeys: 3 },
      { role: "admin", trips: 2, uniqueKeys: 1 },
    ]);
  });

  it("groups null roles under the 'unknown' label", async () => {
    const limiter = newCappedLimiter();
    await limiter.enforce(mkReq(), mkRes(), null);
    await limiter.enforce(mkReq(), mkRes(), null);
    const summary = limiter.summarizeRecentTrips({ windowMs: 60_000 });
    expect(summary.byRole).toEqual([
      { role: "unknown", trips: 1, uniqueKeys: 1 },
    ]);
  });

  it("__resetStateForTests also clears the trips buffer", async () => {
    const limiter = newCappedLimiter();
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    expect(limiter.getRecentTrips()).toHaveLength(1);
    await limiter.__resetStateForTests();
    expect(limiter.getRecentTrips()).toEqual([]);
    expect(limiter.getTripsBufferInfo().currentSize).toBe(0);
  });

  it("returns defensive copies callers can mutate without affecting the buffer", async () => {
    const limiter = newCappedLimiter();
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    await limiter.enforce(mkReq(), mkRes(), { userId: 7, role: "vendor" });
    const trips = limiter.getRecentTrips();
    trips[0].role = "TAMPERED";
    trips.length = 0;
    expect(limiter.getRecentTrips()[0].role).toBe("vendor");
  });
});
