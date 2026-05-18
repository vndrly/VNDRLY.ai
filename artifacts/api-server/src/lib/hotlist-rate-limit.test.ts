import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceHotlistRateLimit,
  getHotlistBudgetForRole,
  HOTLIST_RATE_LIMIT_CONFIG,
  __resetHotlistRateLimitStateForTests,
} from "./hotlist-rate-limit";
import type { Request, Response } from "express";

// Smoke tests that the hotlist limiter wires up the right env-var
// prefix and `code`/`message` strings, and that the per-role
// override convention required by Task #689 produces different
// budgets for different roles. Full behavioural matrix lives in
// `rate-limit-factory.test.ts`.

beforeEach(async () => {
  await __resetHotlistRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function mkReq(): Request {
  return {
    path: "/api/hotlist/jobs",
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

describe("hotlist rate limiter", () => {
  it("uses the default 30 req / 10s budget when no env is set", () => {
    expect(HOTLIST_RATE_LIMIT_CONFIG.max).toBe(30);
    expect(HOTLIST_RATE_LIMIT_CONFIG.windowMs).toBe(10_000);
  });

  it("reads the HOTLIST_RATE_LIMIT_MAX env override", () => {
    vi.stubEnv("HOTLIST_RATE_LIMIT_MAX", "9");
    expect(HOTLIST_RATE_LIMIT_CONFIG.max).toBe(9);
    expect(getHotlistBudgetForRole(null).max).toBe(9);
  });

  it("supports per-role HOTLIST_RATE_LIMIT_MAX_<ROLE> overrides", () => {
    vi.stubEnv("HOTLIST_RATE_LIMIT_MAX_PARTNER", "180");
    vi.stubEnv("HOTLIST_RATE_LIMIT_MAX_VENDOR", "25");
    const partner = getHotlistBudgetForRole("partner");
    const vendor = getHotlistBudgetForRole("vendor");
    expect(partner.max).toBe(180);
    expect(vendor.max).toBe(25);
    expect(partner.max).not.toBe(vendor.max);
  });

  it("trips with the hotlist-specific code on the 429 body", async () => {
    vi.stubEnv("HOTLIST_RATE_LIMIT_MAX_VENDOR", "1");
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 7, role: "vendor" };
    expect(await enforceHotlistRateLimit(req, res.res, session)).toBe(true);
    expect(await enforceHotlistRateLimit(req, res.res, session)).toBe(false);
    expect(res.getStatus()).toBe(429);
    expect(res.getBody()).toMatchObject({
      error: "rate_limited",
      code: "hotlist.rate_limited",
      limit: 1,
    });
    expect(res.getHeaders()["Retry-After"]).toBeDefined();
  });
});
