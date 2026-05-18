import { describe, it, expect, beforeEach } from "vitest";
import type { Request } from "express";
import {
  consumeDailyBudget,
  getClientIp,
  getSignupAssistantDigestSnapshot,
  getSignupAssistantUsage,
  recordIpHit,
  recordSignupAssistantDigestHit,
  SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG,
  __resetSignupAssistantStateForTests,
  __setSignupAssistantStoreForTests,
} from "./signup-assistant-rate-limit";
import { MemoryBucketStore } from "./bucket-store";

// Pin every test to its own MemoryBucketStore so a parallel
// vitest worker that has already configured the singleton (e.g.
// pointed it at a Redis double in another suite) can't bleed
// state into these cases.
beforeEach(async () => {
  __setSignupAssistantStoreForTests(new MemoryBucketStore());
  await __resetSignupAssistantStateForTests();
});

describe("recordIpHit (per-IP fixed-window limiter)", () => {
  it("allows up to the configured cap within the window, then blocks", async () => {
    const ip = "203.0.113.10";
    const now = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.ipMax; i++) {
      const result = await recordIpHit(ip, now);
      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.ipMax - (i + 1));
    }
    const blocked = await recordIpHit(ip, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(
      SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.ipWindowMs,
    );
  });

  it("resets the counter once the window has elapsed", async () => {
    const ip = "203.0.113.11";
    const t0 = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.ipMax; i++) {
      expect((await recordIpHit(ip, t0)).ok).toBe(true);
    }
    expect((await recordIpHit(ip, t0)).ok).toBe(false);

    const t1 = t0 + SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.ipWindowMs + 1;
    const afterReset = await recordIpHit(ip, t1);
    expect(afterReset.ok).toBe(true);
    expect(afterReset.remaining).toBe(SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.ipMax - 1);
  });

  it("tracks separate IPs independently", async () => {
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.ipMax; i++) {
      expect((await recordIpHit("198.51.100.1", t)).ok).toBe(true);
    }
    expect((await recordIpHit("198.51.100.1", t)).ok).toBe(false);
    // Different IP unaffected.
    expect((await recordIpHit("198.51.100.2", t)).ok).toBe(true);
  });
});

describe("consumeDailyBudget (global circuit breaker)", () => {
  it("increments used count up to budget then trips", async () => {
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    // Driving the budget to zero in a single test would be slow at the
    // default 2000 cap, so we exercise the boundary by reading state
    // and asserting monotonic increase.
    const r1 = await consumeDailyBudget(t);
    expect(r1.ok).toBe(true);
    expect(r1.used).toBe(1);
    expect(r1.budget).toBe(SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.dailyBudget);
    const r2 = await consumeDailyBudget(t);
    expect(r2.ok).toBe(true);
    expect(r2.used).toBe(2);
    expect(r2.remaining).toBe(SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.dailyBudget - 2);
  });

  it("trips when used reaches budget", async () => {
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.dailyBudget; i++) {
      const r = await consumeDailyBudget(t);
      expect(r.ok).toBe(true);
    }
    const tripped = await consumeDailyBudget(t);
    expect(tripped.ok).toBe(false);
    expect(tripped.used).toBe(SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.dailyBudget);
    expect(tripped.remaining).toBe(0);
  });

  it("rolls over to a fresh budget at UTC midnight", async () => {
    const day1 = Date.UTC(2026, 3, 27, 23, 30, 0);
    const r1 = await consumeDailyBudget(day1);
    expect(r1.ok).toBe(true);
    expect(r1.dayKey).toBe("2026-04-27");
    expect(r1.used).toBe(1);
    const r2 = await consumeDailyBudget(day1);
    expect(r2.used).toBe(2);

    // Cross UTC midnight into the next day; counter must reset.
    // The bucket key includes the day-string, so a hit on the new
    // day lands on a brand-new bucket regardless of the previous
    // day's bucket TTL — the rollover is structural, not based on
    // expiry.
    const day2 = Date.UTC(2026, 3, 28, 0, 5, 0);
    const r3 = await consumeDailyBudget(day2);
    expect(r3.ok).toBe(true);
    expect(r3.dayKey).toBe("2026-04-28");
    expect(r3.used).toBe(1);
  });
});

describe("getSignupAssistantUsage", () => {
  it("returns the configured budget and the live count", async () => {
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await consumeDailyBudget(t);
    await consumeDailyBudget(t);
    await recordIpHit("203.0.113.40", t);
    const snap = await getSignupAssistantUsage(t);
    expect(snap.used).toBe(2);
    expect(snap.budget).toBe(SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.dailyBudget);
    expect(snap.activeIpBuckets).toBe(1);
    expect(snap.dayKey).toBe("2026-04-27");
    expect(snap.ipMax).toBe(SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.ipMax);
    expect(snap.ipWindowMs).toBe(SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.ipWindowMs);
  });

  it("reports zero state on a fresh process", async () => {
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const snap = await getSignupAssistantUsage(t);
    expect(snap.used).toBe(0);
    expect(snap.activeIpBuckets).toBe(0);
  });

  it("does not consume daily budget when called", async () => {
    // Regression guard for the migration to the shared BucketStore:
    // peek must read counters without calling INCR, so polling the
    // admin readout cannot itself burn the per-day budget.
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    await consumeDailyBudget(t);
    for (let i = 0; i < 5; i++) {
      await getSignupAssistantUsage(t);
    }
    const after = await getSignupAssistantUsage(t);
    expect(after.used).toBe(1);
  });
});

describe("recordSignupAssistantDigestHit / getSignupAssistantDigestSnapshot", () => {
  it("returns an empty snapshot for the current day when nothing was recorded", () => {
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const snap = getSignupAssistantDigestSnapshot(10, t);
    expect(snap.dayKey).toBe("2026-04-27");
    expect(snap.totalRequests).toBe(0);
    expect(snap.totalDispatched).toBe(0);
    expect(snap.ipBlocks).toBe(0);
    expect(snap.breakerTripped).toBe(0);
    expect(snap.uniqueIps).toBe(0);
    expect(snap.topIps).toEqual([]);
  });

  it("aggregates totals and per-IP counts across the three outcome branches", () => {
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    recordSignupAssistantDigestHit("203.0.113.1", { dispatched: true, ipBlocked: false, breakerTripped: false }, t);
    recordSignupAssistantDigestHit("203.0.113.1", { dispatched: true, ipBlocked: false, breakerTripped: false }, t);
    recordSignupAssistantDigestHit("203.0.113.1", { dispatched: false, ipBlocked: true, breakerTripped: false }, t);
    recordSignupAssistantDigestHit("203.0.113.2", { dispatched: false, ipBlocked: false, breakerTripped: true }, t);
    const snap = getSignupAssistantDigestSnapshot(10, t);
    expect(snap.totalRequests).toBe(4);
    expect(snap.totalDispatched).toBe(2);
    expect(snap.ipBlocks).toBe(1);
    expect(snap.breakerTripped).toBe(1);
    expect(snap.uniqueIps).toBe(2);
    // Sorted by request count desc.
    expect(snap.topIps[0]).toEqual({ ip: "203.0.113.1", requests: 3, dispatched: 2 });
    expect(snap.topIps[1]).toEqual({ ip: "203.0.113.2", requests: 1, dispatched: 0 });
  });

  it("respects the topN cap and resets at UTC midnight", () => {
    const day1 = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < 5; i++) {
      recordSignupAssistantDigestHit(
        `203.0.113.${i}`,
        { dispatched: true, ipBlocked: false, breakerTripped: false },
        day1,
      );
    }
    const top2 = getSignupAssistantDigestSnapshot(2, day1);
    expect(top2.uniqueIps).toBe(5);
    expect(top2.topIps).toHaveLength(2);

    // After UTC midnight the snapshot is empty: the digest worker
    // calls this BEFORE the day rolls over so a stale day's data
    // must not leak into a fresh snapshot.
    const day2 = Date.UTC(2026, 3, 28, 0, 5, 0);
    const fresh = getSignupAssistantDigestSnapshot(10, day2);
    expect(fresh.dayKey).toBe("2026-04-28");
    expect(fresh.totalRequests).toBe(0);
    expect(fresh.uniqueIps).toBe(0);
  });
});

describe("getClientIp", () => {
  function mkReq(headers: Record<string, string | string[] | undefined>, remoteAddress?: string): Request {
    return {
      headers,
      socket: { remoteAddress } as Request["socket"],
      ip: remoteAddress,
    } as unknown as Request;
  }

  it("uses the leftmost x-forwarded-for entry when present", () => {
    expect(getClientIp(mkReq({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("handles the array form of x-forwarded-for", () => {
    expect(getClientIp(mkReq({ "x-forwarded-for": ["198.51.100.5, 10.0.0.1"] }))).toBe(
      "198.51.100.5",
    );
  });

  it("falls back to the socket remote address when no header is set", () => {
    expect(getClientIp(mkReq({}, "127.0.0.1"))).toBe("127.0.0.1");
  });

  it("returns 'unknown' as a last resort when nothing is available", () => {
    expect(getClientIp(mkReq({}))).toBe("unknown");
  });
});
