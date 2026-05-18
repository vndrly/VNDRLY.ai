import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceNotificationsRateLimit,
  getNotificationsBudgetForRole,
  NOTIFICATIONS_RATE_LIMIT_CONFIG,
  __resetNotificationsRateLimitStateForTests,
} from "./notifications-rate-limit";
import type { Request, Response } from "express";

// Smoke tests that the notifications limiter wires up the right
// env-var prefix and `code`/`message` strings, and that the per-role
// override convention required by Task #689 produces different
// budgets for different roles. The full behavioural matrix is
// covered in `rate-limit-factory.test.ts`.

beforeEach(async () => {
  await __resetNotificationsRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function mkReq(): Request {
  return {
    path: "/api/notifications",
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

describe("notifications rate limiter", () => {
  it("uses the default 30 req / 10s budget when no env is set", () => {
    expect(NOTIFICATIONS_RATE_LIMIT_CONFIG.max).toBe(30);
    expect(NOTIFICATIONS_RATE_LIMIT_CONFIG.windowMs).toBe(10_000);
  });

  it("reads the NOTIFICATIONS_RATE_LIMIT_MAX env override", () => {
    vi.stubEnv("NOTIFICATIONS_RATE_LIMIT_MAX", "11");
    expect(NOTIFICATIONS_RATE_LIMIT_CONFIG.max).toBe(11);
    expect(getNotificationsBudgetForRole(null).max).toBe(11);
  });

  it("supports per-role NOTIFICATIONS_RATE_LIMIT_MAX_<ROLE> overrides", () => {
    // Required by Task #689: different roles must be tunable to
    // different budgets on each new limiter.
    vi.stubEnv("NOTIFICATIONS_RATE_LIMIT_MAX_DISPATCHER", "200");
    vi.stubEnv("NOTIFICATIONS_RATE_LIMIT_MAX_VENDOR", "10");
    const dispatcher = getNotificationsBudgetForRole("dispatcher");
    const vendor = getNotificationsBudgetForRole("vendor");
    expect(dispatcher.max).toBe(200);
    expect(vendor.max).toBe(10);
    expect(dispatcher.max).not.toBe(vendor.max);
  });

  it("trips with the notifications-specific code on the 429 body", async () => {
    vi.stubEnv("NOTIFICATIONS_RATE_LIMIT_MAX_VENDOR", "1");
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 7, role: "vendor" };
    expect(await enforceNotificationsRateLimit(req, res.res, session)).toBe(true);
    expect(await enforceNotificationsRateLimit(req, res.res, session)).toBe(false);
    expect(res.getStatus()).toBe(429);
    expect(res.getBody()).toMatchObject({
      error: "rate_limited",
      code: "notifications.rate_limited",
      limit: 1,
    });
    expect(res.getHeaders()["Retry-After"]).toBeDefined();
  });
});
