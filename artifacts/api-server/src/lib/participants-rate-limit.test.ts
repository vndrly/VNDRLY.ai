import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceParticipantsRateLimit,
  getParticipantsBudgetForRole,
  PARTICIPANTS_RATE_LIMIT_CONFIG,
  __resetParticipantsRateLimitStateForTests,
} from "./participants-rate-limit";
import type { Request, Response } from "express";

// Smoke tests that the participants limiter wires up the right
// env-var prefix and `code`/`message` strings, and that the per-role
// override convention required by Task #689 produces different
// budgets for different roles. Full behavioural matrix lives in
// `rate-limit-factory.test.ts`.

beforeEach(async () => {
  await __resetParticipantsRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function mkReq(): Request {
  return {
    path: "/api/tickets/123/comments-participants",
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

describe("participants rate limiter", () => {
  it("uses the default 30 req / 10s budget when no env is set", () => {
    expect(PARTICIPANTS_RATE_LIMIT_CONFIG.max).toBe(30);
    expect(PARTICIPANTS_RATE_LIMIT_CONFIG.windowMs).toBe(10_000);
  });

  it("reads the PARTICIPANTS_RATE_LIMIT_MAX env override", () => {
    vi.stubEnv("PARTICIPANTS_RATE_LIMIT_MAX", "7");
    expect(PARTICIPANTS_RATE_LIMIT_CONFIG.max).toBe(7);
    expect(getParticipantsBudgetForRole(null).max).toBe(7);
  });

  it("supports per-role PARTICIPANTS_RATE_LIMIT_MAX_<ROLE> overrides", () => {
    vi.stubEnv("PARTICIPANTS_RATE_LIMIT_MAX_DISPATCHER", "120");
    vi.stubEnv("PARTICIPANTS_RATE_LIMIT_MAX_VENDOR", "15");
    const dispatcher = getParticipantsBudgetForRole("dispatcher");
    const vendor = getParticipantsBudgetForRole("vendor");
    expect(dispatcher.max).toBe(120);
    expect(vendor.max).toBe(15);
    expect(dispatcher.max).not.toBe(vendor.max);
  });

  it("trips with the participants-specific code on the 429 body", async () => {
    vi.stubEnv("PARTICIPANTS_RATE_LIMIT_MAX_VENDOR", "1");
    const req = mkReq();
    const res = mkRes();
    const session = { userId: 7, role: "vendor" };
    expect(await enforceParticipantsRateLimit(req, res.res, session)).toBe(true);
    expect(await enforceParticipantsRateLimit(req, res.res, session)).toBe(false);
    expect(res.getStatus()).toBe(429);
    expect(res.getBody()).toMatchObject({
      error: "rate_limited",
      code: "participants.rate_limited",
      limit: 1,
    });
    expect(res.getHeaders()["Retry-After"]).toBeDefined();
  });
});
