import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceCommentsRateLimit,
  getCommentsBudgetForRole,
  COMMENTS_RATE_LIMIT_CONFIG,
  __resetCommentsRateLimitStateForTests,
} from "./comments-rate-limit";
import type { Request, Response } from "express";

// Smoke tests that the comments limiter wires up the right env-var
// prefix and `code`/`message` strings, and that the per-role
// override convention required by Task #689 produces different
// budgets for different roles. Full behavioural matrix lives in
// `rate-limit-factory.test.ts`.

beforeEach(async () => {
  await __resetCommentsRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function mkReq(): Request {
  return {
    path: "/api/tickets/123/comments",
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

describe("comments rate limiter", () => {
  it("uses the default 30 req / 10s budget when no env is set", () => {
    expect(COMMENTS_RATE_LIMIT_CONFIG.max).toBe(30);
    expect(COMMENTS_RATE_LIMIT_CONFIG.windowMs).toBe(10_000);
  });

  it("reads the COMMENTS_RATE_LIMIT_MAX env override", () => {
    vi.stubEnv("COMMENTS_RATE_LIMIT_MAX", "8");
    expect(COMMENTS_RATE_LIMIT_CONFIG.max).toBe(8);
    expect(getCommentsBudgetForRole(null).max).toBe(8);
  });

  it("supports per-role COMMENTS_RATE_LIMIT_MAX_<ROLE> overrides", () => {
    vi.stubEnv("COMMENTS_RATE_LIMIT_MAX_ADMIN", "150");
    vi.stubEnv("COMMENTS_RATE_LIMIT_MAX_PARTNER", "20");
    const admin = getCommentsBudgetForRole("admin");
    const partner = getCommentsBudgetForRole("partner");
    expect(admin.max).toBe(150);
    expect(partner.max).toBe(20);
    expect(admin.max).not.toBe(partner.max);
  });

  it("trips with the comments-specific code on the 429 body", async () => {
    vi.stubEnv("COMMENTS_RATE_LIMIT_MAX_PARTNER", "1");
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 7, role: "partner" };
    expect(await enforceCommentsRateLimit(req, res.res, session)).toBe(true);
    expect(await enforceCommentsRateLimit(req, res.res, session)).toBe(false);
    expect(res.getStatus()).toBe(429);
    expect(res.getBody()).toMatchObject({
      error: "rate_limited",
      code: "comments.rate_limited",
      limit: 1,
    });
    expect(res.getHeaders()["Retry-After"]).toBeDefined();
  });
});
