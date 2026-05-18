import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Request, Response } from "express";
import {
  enforceTicketsRateLimit,
  getTicketsBudgetForRole,
  getTicketsRateLimitKey,
  recordTicketsHit,
  TICKETS_RATE_LIMIT_CONFIG,
  __resetTicketsRateLimitStateForTests,
} from "./tickets-rate-limit";

beforeEach(async () => {
  await __resetTicketsRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recordTicketsHit (per-key fixed-window limiter)", () => {
  it("allows up to the configured cap within the window, then blocks", async () => {
    const key = "u:42";
    const now = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < TICKETS_RATE_LIMIT_CONFIG.max; i++) {
      const result = await recordTicketsHit(key, undefined, now);
      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(TICKETS_RATE_LIMIT_CONFIG.max - (i + 1));
    }
    const blocked = await recordTicketsHit(key, undefined, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(
      TICKETS_RATE_LIMIT_CONFIG.windowMs,
    );
  });

  it("resets the counter once the window has elapsed", async () => {
    const key = "u:43";
    const t0 = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < TICKETS_RATE_LIMIT_CONFIG.max; i++) {
      expect((await recordTicketsHit(key, undefined, t0)).ok).toBe(true);
    }
    expect((await recordTicketsHit(key, undefined, t0)).ok).toBe(false);

    const t1 = t0 + TICKETS_RATE_LIMIT_CONFIG.windowMs + 1;
    const afterReset = await recordTicketsHit(key, undefined, t1);
    expect(afterReset.ok).toBe(true);
    expect(afterReset.remaining).toBe(TICKETS_RATE_LIMIT_CONFIG.max - 1);
  });

  it("tracks separate keys independently", async () => {
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < TICKETS_RATE_LIMIT_CONFIG.max; i++) {
      expect((await recordTicketsHit("u:1", undefined, t)).ok).toBe(true);
    }
    expect((await recordTicketsHit("u:1", undefined, t)).ok).toBe(false);
    // Different session unaffected.
    expect((await recordTicketsHit("u:2", undefined, t)).ok).toBe(true);
  });

  it("tolerates the normal poll + manual-refresh cadence without tripping", async () => {
    // The list page does not poll on a refetchInterval; refreshes come
    // from SSE-driven invalidations and the (cooldown-throttled) manual
    // refresh button. A pessimistic burst of 1 req/sec for the entire
    // window length should still leave us comfortably below the cap.
    const key = "u:steady";
    const start = Date.UTC(2026, 3, 27, 12, 0, 0);
    const stride = 1000; // 1 req/sec
    const burst = Math.floor(TICKETS_RATE_LIMIT_CONFIG.windowMs / stride);
    for (let i = 0; i < burst; i++) {
      const result = await recordTicketsHit(key, undefined, start + i * stride);
      expect(result.ok).toBe(true);
    }
  });

  it("returns retryAfterMs that points at the bucket reset time", async () => {
    const key = "u:retry";
    const t0 = Date.UTC(2026, 3, 27, 12, 0, 0);
    for (let i = 0; i < TICKETS_RATE_LIMIT_CONFIG.max; i++) {
      await recordTicketsHit(key, undefined, t0);
    }
    const tripAt = t0 + 250;
    const blocked = await recordTicketsHit(key, undefined, tripAt);
    expect(blocked.ok).toBe(false);
    // The reset is `t0 + windowMs`; trip happened 250ms in, so the
    // retry hint should be `windowMs - 250`.
    expect(blocked.retryAfterMs).toBe(
      TICKETS_RATE_LIMIT_CONFIG.windowMs - 250,
    );
  });

  it("honours an explicit per-call budget instead of the default", async () => {
    const key = "u:explicit";
    const t = Date.UTC(2026, 3, 27, 12, 0, 0);
    const budget = { max: 2, windowMs: 5_000 };
    expect((await recordTicketsHit(key, budget, t)).ok).toBe(true);
    expect((await recordTicketsHit(key, budget, t)).ok).toBe(true);
    const blocked = await recordTicketsHit(key, budget, t);
    expect(blocked.ok).toBe(false);
    expect(blocked.limit).toBe(2);
    expect(blocked.windowMs).toBe(5_000);
  });
});

describe("getTicketsRateLimitKey", () => {
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
    expect(getTicketsRateLimitKey(mkReq(), { userId: 7 })).toBe("u:7");
  });

  it("falls back to the client IP when no session is decoded", () => {
    const req = mkReq({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(getTicketsRateLimitKey(req, null)).toBe("ip:203.0.113.5");
  });

  it("does not collapse two different sessions onto the same bucket", () => {
    expect(getTicketsRateLimitKey(mkReq(), { userId: 7 })).not.toBe(
      getTicketsRateLimitKey(mkReq(), { userId: 8 }),
    );
  });
});

describe("getTicketsBudgetForRole (per-role override resolution)", () => {
  it("returns the global default for unauthenticated callers", () => {
    expect(getTicketsBudgetForRole(null)).toEqual({
      max: TICKETS_RATE_LIMIT_CONFIG.max,
      windowMs: TICKETS_RATE_LIMIT_CONFIG.windowMs,
    });
    expect(getTicketsBudgetForRole(undefined)).toEqual({
      max: TICKETS_RATE_LIMIT_CONFIG.max,
      windowMs: TICKETS_RATE_LIMIT_CONFIG.windowMs,
    });
  });

  it("returns the global default for malformed/spoofed role strings", () => {
    // Roles that don't match `^[a-z][a-z0-9_]{0,31}$` cannot drive
    // env-var lookups; they share the same default as unauthenticated
    // callers. This guards against attacker-chosen env-var names like
    // `PATH` or `../HOME` being derived from a manipulated session.
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
      expect(getTicketsBudgetForRole(bad)).toEqual({
        max: TICKETS_RATE_LIMIT_CONFIG.max,
        windowMs: TICKETS_RATE_LIMIT_CONFIG.windowMs,
      });
    }
  });

  it("returns the global default for a sanitized role with no override set", () => {
    // The role string is well-formed but no `TICKETS_RATE_LIMIT_MAX_*`
    // env is set for it, so the global default applies. Adding an
    // override is purely additive.
    expect(getTicketsBudgetForRole("dispatcher")).toEqual({
      max: TICKETS_RATE_LIMIT_CONFIG.max,
      windowMs: TICKETS_RATE_LIMIT_CONFIG.windowMs,
    });
  });

  it("picks the per-role max override when the env var is set", () => {
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX_ADMIN", "120");
    expect(getTicketsBudgetForRole("admin")).toEqual({
      max: 120,
      windowMs: TICKETS_RATE_LIMIT_CONFIG.windowMs,
    });
  });

  it("honours overrides for any sanitized role, including the dispatcher example", () => {
    // The motivating example in the task description: dispatchers
    // viewing the live tickets board legitimately generate more
    // traffic than a vendor checking a single ticket.
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX_DISPATCHER", "150");
    vi.stubEnv("TICKETS_RATE_LIMIT_WINDOW_MS_DISPATCHER", "20000");
    expect(getTicketsBudgetForRole("dispatcher")).toEqual({
      max: 150,
      windowMs: 20_000,
    });
  });

  it("picks the per-role window override when the env var is set", () => {
    vi.stubEnv("TICKETS_RATE_LIMIT_WINDOW_MS_VENDOR", "60000");
    expect(getTicketsBudgetForRole("vendor")).toEqual({
      max: TICKETS_RATE_LIMIT_CONFIG.max,
      windowMs: 60_000,
    });
  });

  it("gives different roles different budgets when both are configured", () => {
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX_ADMIN", "200");
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX_FIELD_EMPLOYEE", "10");
    const admin = getTicketsBudgetForRole("admin");
    const field = getTicketsBudgetForRole("field_employee");
    expect(admin.max).toBe(200);
    expect(field.max).toBe(10);
    expect(admin.max).not.toBe(field.max);
  });

  it("ignores garbage env values and falls back to the global default", () => {
    for (const bad of ["not-a-number", "0", "-5", "2.5", "Infinity", "NaN"]) {
      vi.stubEnv("TICKETS_RATE_LIMIT_MAX_PARTNER", bad);
      expect(getTicketsBudgetForRole("partner").max).toBe(
        TICKETS_RATE_LIMIT_CONFIG.max,
      );
    }
  });
});

describe("enforceTicketsRateLimit (role-aware integration)", () => {
  function mkReq(): Request {
    return {
      path: "/api/tickets",
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
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX_ADMIN", "5");
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX_VENDOR", "2");

    const adminReq = mkReq();
    const vendorReq = mkReq();
    const adminRes = mkRes();
    const vendorRes = mkRes();

    const admin = { userId: 1, role: "admin" };
    const vendor = { userId: 2, role: "vendor" };

    // Vendor exhausts its 2-call budget first.
    expect(await enforceTicketsRateLimit(vendorReq, vendorRes.res, vendor)).toBe(
      true,
    );
    expect(await enforceTicketsRateLimit(vendorReq, vendorRes.res, vendor)).toBe(
      true,
    );
    expect(await enforceTicketsRateLimit(vendorReq, vendorRes.res, vendor)).toBe(
      false,
    );
    expect(vendorRes.getStatus()).toBe(429);
    expect(vendorRes.getHeaders()["Retry-After"]).toBeDefined();
    expect(vendorRes.getBody()).toMatchObject({
      code: "tickets.rate_limited",
      limit: 2,
    });

    // Admin still has headroom on its larger 5-call budget.
    for (let i = 0; i < 5; i++) {
      expect(await enforceTicketsRateLimit(adminReq, adminRes.res, admin)).toBe(
        true,
      );
    }
    expect(await enforceTicketsRateLimit(adminReq, adminRes.res, admin)).toBe(
      false,
    );
    expect(adminRes.getBody()).toMatchObject({ limit: 5 });
  });

  it("unauthenticated requests use the global default budget", async () => {
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX", "3");
    const req = mkReq();
    const res = mkRes();
    expect(await enforceTicketsRateLimit(req, res.res, null)).toBe(true);
    expect(await enforceTicketsRateLimit(req, res.res, null)).toBe(true);
    expect(await enforceTicketsRateLimit(req, res.res, null)).toBe(true);
    expect(await enforceTicketsRateLimit(req, res.res, null)).toBe(false);
    expect(res.getBody()).toMatchObject({ limit: 3 });
  });

  it("dispatchers get their configured per-role budget end-to-end", async () => {
    // The motivating scenario from the task: a dispatcher viewing the
    // live board needs more headroom than the global default. With
    // the override set, the limiter must reflect it through the full
    // request -> 429 path.
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX", "2");
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX_DISPATCHER", "4");
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 9, role: "dispatcher" };
    for (let i = 0; i < 4; i++) {
      expect(await enforceTicketsRateLimit(req, res.res, session)).toBe(true);
    }
    expect(await enforceTicketsRateLimit(req, res.res, session)).toBe(false);
    expect(res.getBody()).toMatchObject({ limit: 4 });
  });

  it("falls back to the global default for malformed role strings", async () => {
    // Roles that don't match the sanitized pattern can't drive
    // env-var lookups — they share the unauthenticated default,
    // regardless of any env var an attacker might try to influence.
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX", "2");
    vi.stubEnv("TICKETS_RATE_LIMIT_MAX_PATH", "999");
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 11, role: "../PATH" };
    expect(await enforceTicketsRateLimit(req, res.res, session)).toBe(true);
    expect(await enforceTicketsRateLimit(req, res.res, session)).toBe(true);
    expect(await enforceTicketsRateLimit(req, res.res, session)).toBe(false);
    expect(res.getBody()).toMatchObject({ limit: 2 });
  });
});
