import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  executeRows: [] as unknown[][],
  signupUsage: {
    dayKey: "2026-10-19",
    used: 3,
    budget: 100,
    activeIpBuckets: 2,
    ipMax: 10,
    ipWindowMs: 60_000,
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const query = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "groupBy", "orderBy", "limit", "leftJoin", "innerJoin"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return chain;
  };
  return {
    ...actual,
    db: {
      select: vi.fn(() => query(mocks.selectRows.shift() ?? [])),
      execute: vi.fn(async () => mocks.executeRows.shift() ?? []),
    },
  };
});

vi.mock("../lib/signup-assistant-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/signup-assistant-rate-limit")>()),
  getSignupAssistantUsage: vi.fn(async () => mocks.signupUsage),
}));

import assistantRouter from "./assistant";

function app() {
  return express()
    .use(express.json())
    .use(cookieParser())
    .use("/api", assistantRouter);
}

describe("GET /api/assistant/metrics", () => {
  beforeEach(() => {
    mocks.selectRows.length = 0;
    mocks.executeRows.length = 0;
  });

  it("returns 401 without a session cookie", async () => {
    const response = await request(app()).get("/api/assistant/metrics");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Not authenticated",
      code: "auth.not_authenticated",
    });
  });

  it("returns 401 when the session cookie signature is invalid", async () => {
    const response = await request(app())
      .get("/api/assistant/metrics")
      .set("Cookie", "vndrly_session=not-a-real-session-id");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("auth.not_authenticated");
  });

  it("returns the documented bounded metrics payload for an admin", async () => {
    mocks.selectRows.push(
      [{ day: "2026-10-18", count: 4 }],
      [{ day: "2026-10-18", count: 11 }],
      [{ refusalCount: 2 }],
      [{ orgType: "vendor", count: 5 }],
    );
    mocks.executeRows.push(
      [{ helpful_count: 6, unhelpful_count: 1 }],
      [{ avg_ms: 240, p95_ms: 410, sample: 7 }],
    );
    const cookie = buildTestCookie({ userId: 1, role: "admin" });

    const response = await request(app())
      .get("/api/assistant/metrics?days=14")
      .set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      rangeDays: 14,
      sessionsByDay: [{ day: "2026-10-18", count: 4 }],
      messagesByDay: [{ day: "2026-10-18", count: 11 }],
      refusalCount: 2,
      helpfulCount: 6,
      unhelpfulCount: 1,
      feedbackCount: 7,
      ttftMs: { avg: 240, p95: 410, sample: 7 },
      completedOnboardingByOrg: [{ orgType: "vendor", count: 5 }],
      signupAssistant: {
        dayKey: "2026-10-19",
        todayUsed: 3,
        todayBudget: 100,
        activeIpBuckets: 2,
        ipMax: 10,
        ipWindowMs: 60_000,
      },
    });
    expect(response.body.since).toEqual(expect.any(String));
  });
});
