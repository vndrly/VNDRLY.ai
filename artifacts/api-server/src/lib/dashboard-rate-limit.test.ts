import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceDashboardRateLimit,
  getDashboardBudgetForRole,
  DASHBOARD_RATE_LIMIT_CONFIG,
  __resetDashboardRateLimitStateForTests,
} from "./dashboard-rate-limit";
import type { Request, Response } from "express";

// Smoke tests that the dashboard limiter wires up the right env-var
// prefix and `code`/`message` strings, and that the per-role
// override convention required by Task #689 produces different
// budgets for different roles. Full behavioural matrix lives in
// `rate-limit-factory.test.ts`.

beforeEach(async () => {
  await __resetDashboardRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function mkReq(): Request {
  return {
    path: "/api/dashboard/summary",
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

describe("dashboard rate limiter", () => {
  it("uses the default 30 req / 10s budget when no env is set", () => {
    expect(DASHBOARD_RATE_LIMIT_CONFIG.max).toBe(30);
    expect(DASHBOARD_RATE_LIMIT_CONFIG.windowMs).toBe(10_000);
  });

  it("reads the DASHBOARD_RATE_LIMIT_MAX env override", () => {
    vi.stubEnv("DASHBOARD_RATE_LIMIT_MAX", "13");
    expect(DASHBOARD_RATE_LIMIT_CONFIG.max).toBe(13);
    expect(getDashboardBudgetForRole(null).max).toBe(13);
  });

  it("supports per-role DASHBOARD_RATE_LIMIT_MAX_<ROLE> overrides", () => {
    vi.stubEnv("DASHBOARD_RATE_LIMIT_MAX_ADMIN", "210");
    vi.stubEnv("DASHBOARD_RATE_LIMIT_MAX_VENDOR", "16");
    const admin = getDashboardBudgetForRole("admin");
    const vendor = getDashboardBudgetForRole("vendor");
    expect(admin.max).toBe(210);
    expect(vendor.max).toBe(16);
    expect(admin.max).not.toBe(vendor.max);
  });

  it("trips with the dashboard-specific code on the 429 body", async () => {
    vi.stubEnv("DASHBOARD_RATE_LIMIT_MAX_VENDOR", "1");
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 7, role: "vendor" };
    expect(await enforceDashboardRateLimit(req, res.res, session)).toBe(true);
    expect(await enforceDashboardRateLimit(req, res.res, session)).toBe(false);
    expect(res.getStatus()).toBe(429);
    expect(res.getBody()).toMatchObject({
      error: "rate_limited",
      code: "dashboard.rate_limited",
      limit: 1,
    });
    expect(res.getHeaders()["Retry-After"]).toBeDefined();
  });
});
