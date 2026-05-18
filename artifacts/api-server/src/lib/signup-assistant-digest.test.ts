// Pure-logic tests for the signup-assistant abuse-digest worker.
// No real DB or SendGrid; we mock both module surfaces so the
// scheduler logic (decideDigest + run wiring) is testable in
// isolation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IMPORTANT: vi.mock factories run before module imports, so we
// expose the mock control surface through `vi.hoisted` to avoid the
// "Cannot access ... before initialization" trap when the module
// under test imports the mocked symbols at module-load time.
const mocks = vi.hoisted(() => ({
  // Typed as `(input: unknown) => ...` so vitest infers `mock.calls`
  // as `[unknown][]` rather than `[][]`. The latter is what the bare
  // `() => ...` form produces and would make `calls[i]?.[0]` a TS
  // error.
  sendDigest: vi.fn(async (_input: unknown) => ({ messageId: "test-msg" })),
  recipientRows: [] as Array<{
    id: number;
    email: string | null;
    suspendedAt: Date | null;
    systemEnabled: boolean | null;
  }>,
}));

vi.mock("./sendgrid", () => ({
  sendSignupAssistantAbuseDigestEmail: mocks.sendDigest,
}));

// Stub `@workspace/db` so we don't need a real Postgres for the
// recipient query. The drizzle chain we mock matches the shape used
// by `loadDigestRecipients`: select(...).from(...).leftJoin(...).where(...).
vi.mock("@workspace/db", () => {
  const chain = {
    from() { return this; },
    leftJoin() { return this; },
    where() { return Promise.resolve(mocks.recipientRows); },
  };
  return {
    db: { select: () => chain },
    notificationPreferencesTable: { userId: "userId", systemEnabled: "systemEnabled" },
    usersTable: { id: "id", role: "role", email: "email", suspendedAt: "suspendedAt" },
  };
});

// Mock the logger so test output stays clean and we don't depend on
// the pino transport in CI.
vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// We intentionally do NOT mock the rate-limit module — the digest
// worker reads a live in-memory snapshot from it, and resetting the
// real state between cases gives us a deterministic surface to drive
// the scheduler logic against. We DO swap its bucket store to an
// in-memory one so `__resetSignupAssistantStateForTests` doesn't try
// to talk to the real Postgres-backed store (whose `db.execute`
// surface isn't part of the `@workspace/db` mock above).
import { MemoryBucketStore } from "./bucket-store";
import {
  __resetSignupAssistantStateForTests,
  __setSignupAssistantStoreForTests,
  recordSignupAssistantDigestHit,
  SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG,
} from "./signup-assistant-rate-limit";
import {
  __resetSignupAssistantDigestStateForTests,
  loadDigestRecipients,
  runSignupAssistantDigestScan,
} from "./signup-assistant-digest";

beforeEach(async () => {
  __setSignupAssistantStoreForTests(new MemoryBucketStore());
  await __resetSignupAssistantStateForTests();
  __resetSignupAssistantDigestStateForTests();
  mocks.sendDigest.mockClear();
  mocks.recipientRows.length = 0;
});

afterEach(() => {
  delete process.env.SIGNUP_ASSISTANT_DIGEST_HIGH_USAGE_THRESHOLD;
  delete process.env.SIGNUP_ASSISTANT_DIGEST_DAILY_UTC_HOUR;
});

const noonUtc = new Date(Date.UTC(2026, 3, 27, 12, 0, 0));
const lateUtc = new Date(Date.UTC(2026, 3, 27, 23, 5, 0));

function seedAdmin(email = "admin@example.com"): void {
  mocks.recipientRows.push({
    id: 1,
    email,
    suspendedAt: null,
    systemEnabled: true,
  });
}

describe("loadDigestRecipients", () => {
  it("includes admins with system_enabled true and a non-empty email", async () => {
    mocks.recipientRows.push(
      { id: 1, email: "a@example.com", suspendedAt: null, systemEnabled: true },
      { id: 2, email: "b@example.com", suspendedAt: null, systemEnabled: null },
    );
    const out = await loadDigestRecipients();
    expect(out.map((r) => r.email)).toEqual(["a@example.com", "b@example.com"]);
  });

  it("filters out suspended admins, opt-outs, missing emails, and dedupes case-insensitively", async () => {
    mocks.recipientRows.push(
      { id: 1, email: "a@example.com", suspendedAt: new Date(), systemEnabled: true },
      { id: 2, email: "b@example.com", suspendedAt: null, systemEnabled: false },
      { id: 3, email: "  ", suspendedAt: null, systemEnabled: true },
      { id: 4, email: null, suspendedAt: null, systemEnabled: true },
      { id: 5, email: "c@example.com", suspendedAt: null, systemEnabled: true },
      { id: 6, email: "C@Example.com", suspendedAt: null, systemEnabled: null },
    );
    const out = await loadDigestRecipients();
    expect(out.map((r) => r.email)).toEqual(["c@example.com"]);
  });
});

describe("runSignupAssistantDigestScan — no-op cases", () => {
  it("does nothing when below threshold and pre-daily-window", async () => {
    seedAdmin();
    // A single dispatched call is far below the 75% threshold and
    // the wall clock is at noon UTC (well before 23:00).
    recordSignupAssistantDigestHit(
      "203.0.113.10",
      { dispatched: true, ipBlocked: false, breakerTripped: false },
      noonUtc.getTime(),
    );
    const result = await runSignupAssistantDigestScan(noonUtc);
    expect(result.sent).toBe(false);
    expect(result.decision.send).toBe(false);
    expect(mocks.sendDigest).not.toHaveBeenCalled();
  });

  it("skips sending (and does not crash) when no admin recipients are configured", async () => {
    // High-usage condition but zero recipients in the DB.
    recordSignupAssistantDigestHit(
      "203.0.113.10",
      { dispatched: false, ipBlocked: false, breakerTripped: true },
      noonUtc.getTime(),
    );
    const result = await runSignupAssistantDigestScan(noonUtc);
    expect(result.decision.send).toBe(true);
    expect(result.decision.reason).toBe("high_usage");
    expect(result.sent).toBe(false);
    expect(result.recipientCount).toBe(0);
    expect(mocks.sendDigest).not.toHaveBeenCalled();
  });
});

describe("runSignupAssistantDigestScan — high-usage escalation", () => {
  it("fires when usage crosses the threshold and throttles for an hour", async () => {
    seedAdmin();
    process.env.SIGNUP_ASSISTANT_DIGEST_HIGH_USAGE_THRESHOLD = "0.75";
    const need = Math.ceil(SIGNUP_ASSISTANT_RATE_LIMIT_CONFIG.dailyBudget * 0.75);
    for (let i = 0; i < need; i++) {
      recordSignupAssistantDigestHit(
        "203.0.113.10",
        { dispatched: true, ipBlocked: false, breakerTripped: false },
        noonUtc.getTime(),
      );
    }
    const first = await runSignupAssistantDigestScan(noonUtc);
    expect(first.sent).toBe(true);
    expect(first.decision.reason).toBe("high_usage");
    expect(mocks.sendDigest).toHaveBeenCalledTimes(1);
    expect(mocks.sendDigest.mock.calls[0]?.[0]).toMatchObject({
      reason: "high_usage",
      dayKey: "2026-04-27",
      recipients: ["admin@example.com"],
    });

    // Within the throttle window: no second send.
    const stillThrottled = new Date(noonUtc.getTime() + 30 * 60 * 1000);
    const second = await runSignupAssistantDigestScan(stillThrottled);
    expect(second.sent).toBe(false);
    expect(second.decision.note).toContain("throttled");
    expect(mocks.sendDigest).toHaveBeenCalledTimes(1);

    // After 60 minutes elapsed since the first send, the throttle
    // expires and a fresh high-usage condition fires again.
    const afterThrottle = new Date(noonUtc.getTime() + 61 * 60 * 1000);
    const third = await runSignupAssistantDigestScan(afterThrottle);
    expect(third.sent).toBe(true);
    expect(mocks.sendDigest).toHaveBeenCalledTimes(2);
  });

  it("fires for breaker-tripped even when dispatched volume is below the threshold", async () => {
    seedAdmin();
    // Single rejection by the breaker, zero successful dispatches.
    recordSignupAssistantDigestHit(
      "203.0.113.20",
      { dispatched: false, ipBlocked: false, breakerTripped: true },
      noonUtc.getTime(),
    );
    const result = await runSignupAssistantDigestScan(noonUtc);
    expect(result.sent).toBe(true);
    expect(result.decision.reason).toBe("high_usage");
    expect(result.decision.note).toBe("breaker tripped");
    expect(mocks.sendDigest).toHaveBeenCalledTimes(1);
    expect(mocks.sendDigest.mock.calls[0]?.[0]).toMatchObject({
      breakerTripped: 1,
      used: 0,
    });
  });
});

describe("runSignupAssistantDigestScan — daily summary", () => {
  it("fires once per UTC day at/after the configured hour", async () => {
    seedAdmin();
    // No traffic, but the daily-summary email still goes out so
    // admins get baseline visibility and would notice an outage.
    const first = await runSignupAssistantDigestScan(lateUtc);
    expect(first.sent).toBe(true);
    expect(first.decision.reason).toBe("daily_summary");
    expect(mocks.sendDigest).toHaveBeenCalledTimes(1);

    // A subsequent tick the same UTC day must NOT re-send.
    const sameDay = new Date(lateUtc.getTime() + 30 * 60 * 1000);
    const second = await runSignupAssistantDigestScan(sameDay);
    expect(second.sent).toBe(false);
    expect(second.decision.note).toContain("already sent");
    expect(mocks.sendDigest).toHaveBeenCalledTimes(1);

    // A new UTC day (after midnight, after the configured hour again)
    // re-arms the daily summary.
    const nextDay = new Date(Date.UTC(2026, 3, 28, 23, 5, 0));
    const third = await runSignupAssistantDigestScan(nextDay);
    expect(third.sent).toBe(true);
    expect(mocks.sendDigest).toHaveBeenCalledTimes(2);
  });

  it("skips daily summary before the configured UTC hour", async () => {
    seedAdmin();
    process.env.SIGNUP_ASSISTANT_DIGEST_DAILY_UTC_HOUR = "23";
    const earlyEvening = new Date(Date.UTC(2026, 3, 27, 22, 30, 0));
    const result = await runSignupAssistantDigestScan(earlyEvening);
    expect(result.sent).toBe(false);
    expect(mocks.sendDigest).not.toHaveBeenCalled();
  });
});

describe("runSignupAssistantDigestScan — failure isolation", () => {
  it("returns sent=false when SendGrid rejects, and does not advance throttle on failure", async () => {
    seedAdmin();
    mocks.sendDigest.mockRejectedValueOnce(new Error("sendgrid 5xx"));
    recordSignupAssistantDigestHit(
      "203.0.113.30",
      { dispatched: false, ipBlocked: false, breakerTripped: true },
      noonUtc.getTime(),
    );
    const first = await runSignupAssistantDigestScan(noonUtc);
    expect(first.sent).toBe(false);
    expect(mocks.sendDigest).toHaveBeenCalledTimes(1);

    // Because the throttle is only updated on success, the next tick
    // re-attempts immediately rather than swallowing the failure for
    // an hour.
    const next = new Date(noonUtc.getTime() + 1000);
    const second = await runSignupAssistantDigestScan(next);
    expect(second.decision.send).toBe(true);
    expect(mocks.sendDigest).toHaveBeenCalledTimes(2);
  });
});
