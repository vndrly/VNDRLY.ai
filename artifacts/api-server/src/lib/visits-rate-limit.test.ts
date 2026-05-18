import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceVisitsRateLimit,
  getVisitsBudgetForRole,
  VISITS_RATE_LIMIT_CONFIG,
  __resetVisitsRateLimitStateForTests,
} from "./visits-rate-limit";
import type { Request, Response } from "express";

// Smoke tests that the visits limiter wires up the right env-var
// prefix and `code`/`message` strings, and that the per-role
// override convention required by Task #689 produces different
// budgets for different roles. Full behavioural matrix lives in
// `rate-limit-factory.test.ts`.

beforeEach(async () => {
  await __resetVisitsRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function mkReq(): Request {
  return {
    path: "/api/visits",
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

describe("visits rate limiter", () => {
  it("uses the default 30 req / 10s budget when no env is set", () => {
    expect(VISITS_RATE_LIMIT_CONFIG.max).toBe(30);
    expect(VISITS_RATE_LIMIT_CONFIG.windowMs).toBe(10_000);
  });

  it("reads the VISITS_RATE_LIMIT_MAX env override", () => {
    vi.stubEnv("VISITS_RATE_LIMIT_MAX", "12");
    expect(VISITS_RATE_LIMIT_CONFIG.max).toBe(12);
    expect(getVisitsBudgetForRole(null).max).toBe(12);
  });

  it("supports per-role VISITS_RATE_LIMIT_MAX_<ROLE> overrides", () => {
    vi.stubEnv("VISITS_RATE_LIMIT_MAX_ADMIN", "240");
    vi.stubEnv("VISITS_RATE_LIMIT_MAX_VENDOR", "18");
    const admin = getVisitsBudgetForRole("admin");
    const vendor = getVisitsBudgetForRole("vendor");
    expect(admin.max).toBe(240);
    expect(vendor.max).toBe(18);
    expect(admin.max).not.toBe(vendor.max);
  });

  it("trips with the visits-specific code on the 429 body", async () => {
    vi.stubEnv("VISITS_RATE_LIMIT_MAX_VENDOR", "1");
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 7, role: "vendor" };
    expect(await enforceVisitsRateLimit(req, res.res, session)).toBe(true);
    expect(await enforceVisitsRateLimit(req, res.res, session)).toBe(false);
    expect(res.getStatus()).toBe(429);
    expect(res.getBody()).toMatchObject({
      error: "rate_limited",
      code: "visits.rate_limited",
      limit: 1,
    });
    expect(res.getHeaders()["Retry-After"]).toBeDefined();
  });
});
