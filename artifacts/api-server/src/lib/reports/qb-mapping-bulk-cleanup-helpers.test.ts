// Pure unit tests for the env-driven helpers exported alongside the
// retention worker. These don't need a real database — they just exercise
// the env-var parsing/validation that backs the value the
// `/reports/qb-account-mapping/bulk-actions` route surfaces to the UI.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeBulkActionRetentionExpiry,
  DEFAULT_EXPIRES_SOON_DAYS,
  DEFAULT_RETENTION_DAYS,
  getBulkActionExpiresSoonDays,
  getBulkActionRetentionDaysFromEnv,
} from "./qb-mapping-bulk-cleanup";

// The env-only path is exercised directly via getBulkActionRetentionDaysFromEnv
// because the production resolver (`getBulkActionRetentionDays`) now also
// hits the database for the platform_settings override and would need a
// real Postgres for these tests. The DB-precedence behavior is covered by
// the api-server integration tests; here we just pin the env-var fallback.
describe("getBulkActionRetentionDaysFromEnv", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.QB_BULK_ACTION_RETENTION_DAYS;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.QB_BULK_ACTION_RETENTION_DAYS;
    } else {
      process.env.QB_BULK_ACTION_RETENTION_DAYS = original;
    }
  });

  it("returns the default when the env var is unset", () => {
    delete process.env.QB_BULK_ACTION_RETENTION_DAYS;
    expect(getBulkActionRetentionDaysFromEnv()).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("respects a valid env-var override", () => {
    process.env.QB_BULK_ACTION_RETENTION_DAYS = "30";
    expect(getBulkActionRetentionDaysFromEnv()).toBe(30);
  });

  it("falls back to the default for invalid values", () => {
    process.env.QB_BULK_ACTION_RETENTION_DAYS = "not-a-number";
    expect(getBulkActionRetentionDaysFromEnv()).toBe(DEFAULT_RETENTION_DAYS);

    process.env.QB_BULK_ACTION_RETENTION_DAYS = "0";
    expect(getBulkActionRetentionDaysFromEnv()).toBe(DEFAULT_RETENTION_DAYS);

    process.env.QB_BULK_ACTION_RETENTION_DAYS = "999999";
    expect(getBulkActionRetentionDaysFromEnv()).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe("computeBulkActionRetentionExpiry", () => {
  // The route uses this to attach `expiresAt`/`isExpired` to each bulk
  // action it returns; the UI hides the Undo button on rows where
  // `isExpired` is true and renders "Undo available for N more day(s)"
  // copy keyed off `expiresAt`. These tests pin the boundary behavior.

  const day = 24 * 60 * 60 * 1000;

  it("returns createdAt + retentionDays as expiresAt", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const { expiresAt } = computeBulkActionRetentionExpiry(
      createdAt,
      90,
      new Date("2026-01-02T00:00:00Z"),
    );
    expect(expiresAt.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("marks a fresh row as not expired", () => {
    const createdAt = new Date("2026-04-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + day); // 1 day old
    const { isExpired } = computeBulkActionRetentionExpiry(
      createdAt,
      90,
      now,
    );
    expect(isExpired).toBe(false);
  });

  it("marks a row past the retention window as expired", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 91 * day); // 91 days old
    const { isExpired } = computeBulkActionRetentionExpiry(
      createdAt,
      90,
      now,
    );
    expect(isExpired).toBe(true);
  });

  it("treats the exact retention boundary as expired", () => {
    // A row created exactly retentionDays * day ago is at the cutoff;
    // the cleanup worker deletes rows whose createdAt is strictly less
    // than `now - retentionDays`, so a row sitting AT the boundary is
    // about to be pruned. The UI should hide its Undo button now
    // rather than fail the click on the next pruning sweep.
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 90 * day);
    const { isExpired } = computeBulkActionRetentionExpiry(
      createdAt,
      90,
      now,
    );
    expect(isExpired).toBe(true);
  });

  it("respects a custom (shorter) retentionDays override", () => {
    const createdAt = new Date("2026-04-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 8 * day); // 8 days old
    const fresh = computeBulkActionRetentionExpiry(createdAt, 30, now);
    expect(fresh.isExpired).toBe(false);
    const expired = computeBulkActionRetentionExpiry(createdAt, 7, now);
    expect(expired.isExpired).toBe(true);
  });

  it("does not raise expiresSoon when expiresSoonDays is omitted", () => {
    // Backwards-compat sanity check: the original 3-arg signature must
    // keep returning expiresSoon=false so callers that don't pass the
    // new threshold never see surprise badges.
    const createdAt = new Date("2026-04-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 89 * day); // 1 day from expiry
    const { expiresSoon } = computeBulkActionRetentionExpiry(
      createdAt,
      90,
      now,
    );
    expect(expiresSoon).toBe(false);
  });

  it("raises expiresSoon when within the warning band", () => {
    const createdAt = new Date("2026-04-01T00:00:00Z");
    // 84 days old, retention 90, warn 7 — 6 days remain; inside band.
    const now = new Date(createdAt.getTime() + 84 * day);
    const r = computeBulkActionRetentionExpiry(createdAt, 90, now, 7);
    expect(r.isExpired).toBe(false);
    expect(r.expiresSoon).toBe(true);
  });

  it("does not raise expiresSoon when fresh", () => {
    const createdAt = new Date("2026-04-01T00:00:00Z");
    // 1 day old, retention 90, warn 7 — 89 days remain.
    const now = new Date(createdAt.getTime() + 1 * day);
    const r = computeBulkActionRetentionExpiry(createdAt, 90, now, 7);
    expect(r.expiresSoon).toBe(false);
  });

  it("does not raise expiresSoon once a row is already expired", () => {
    const createdAt = new Date("2026-04-01T00:00:00Z");
    // 91 days old, past retention.
    const now = new Date(createdAt.getTime() + 91 * day);
    const r = computeBulkActionRetentionExpiry(createdAt, 90, now, 7);
    expect(r.isExpired).toBe(true);
    expect(r.expiresSoon).toBe(false);
  });

  it("raises expiresSoon at the warning-band boundary", () => {
    // Exactly retentionDays - expiresSoonDays old (= 83 days for a
    // 90/7 setup) should mark expiresSoon true: the row has 7 full
    // days left and is right at the edge of the warning window. The
    // pure helper uses an inclusive `<=` boundary so the badge appears
    // a touch early rather than a touch late.
    const createdAt = new Date("2026-04-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 83 * day);
    const r = computeBulkActionRetentionExpiry(createdAt, 90, now, 7);
    expect(r.expiresSoon).toBe(true);
  });
});

describe("getBulkActionExpiresSoonDays", () => {
  let original: string | undefined;
  let originalRetention: string | undefined;

  beforeEach(() => {
    original = process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS;
    originalRetention = process.env.QB_BULK_ACTION_RETENTION_DAYS;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS;
    } else {
      process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS = original;
    }
    if (originalRetention === undefined) {
      delete process.env.QB_BULK_ACTION_RETENTION_DAYS;
    } else {
      process.env.QB_BULK_ACTION_RETENTION_DAYS = originalRetention;
    }
  });

  it("returns the default when the env var is unset", () => {
    delete process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS;
    expect(getBulkActionExpiresSoonDays()).toBe(DEFAULT_EXPIRES_SOON_DAYS);
  });

  it("respects a valid env-var override", () => {
    process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS = "14";
    expect(getBulkActionExpiresSoonDays()).toBe(14);
  });

  it("falls back to the default for invalid values", () => {
    process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS = "not-a-number";
    expect(getBulkActionExpiresSoonDays()).toBe(DEFAULT_EXPIRES_SOON_DAYS);

    process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS = "0";
    expect(getBulkActionExpiresSoonDays()).toBe(DEFAULT_EXPIRES_SOON_DAYS);
  });

  it("clamps the threshold to retentionDays so it can't exceed retention", () => {
    // A misconfigured env var that exceeds retention would otherwise
    // mark every active row as expiring soon (useless badge). The
    // helper silently caps it.
    process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS = "30";
    expect(getBulkActionExpiresSoonDays(7)).toBe(7);
  });

  it("uses retentionDays from env when no override is passed", () => {
    process.env.QB_BULK_ACTION_RETENTION_DAYS = "5";
    process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS = "30";
    expect(getBulkActionExpiresSoonDays()).toBe(5);
  });
});
