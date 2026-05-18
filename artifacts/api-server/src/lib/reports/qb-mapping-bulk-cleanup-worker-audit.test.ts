// Unit test for the scheduled cleanup worker's audit-row side effect
// (Task #809). The on-demand admin route already writes one audit row
// per real run; the worker now does the same with `actorUserId = null`
// + `actorRole = "system"` so admins see a single complete history of
// what removed which snapshots, regardless of trigger.
//
// We exercise the real `_runScheduledBulkActionCleanupOnce` against the
// in-memory reports mock. The cleanup helper itself runs end-to-end —
// with no seeded bulk-action rows it deletes nothing — so the
// observable side effect is the audit insert.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fixtures,
  makeDrizzleMock,
  makeReportsDbMock,
  resetMockDb,
} from "../../test/mock-reports-db";

vi.mock("@workspace/db", () => makeReportsDbMock());
vi.mock("drizzle-orm", () => makeDrizzleMock());
// Stub the notifications + sendgrid edges so importing the cleanup
// module doesn't pull in their full transitive dependency tree (express
// router, etc.) — we don't exercise the expiry-warning code path here.
vi.mock("../../routes/notifications", () => ({
  notifyUsers: vi.fn(async () => ({ created: 0 })),
}));
vi.mock("../sendgrid", () => ({
  sendBulkActionExpiringEmail: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => {
  resetMockDb();
});

describe("_runScheduledBulkActionCleanupOnce", () => {
  it("writes a system-actor audit row even when nothing is deleted", async () => {
    const mod = await import("./qb-mapping-bulk-cleanup");
    await mod._runScheduledBulkActionCleanupOnce("interval");

    const audit = fixtures.qbAccountMappingCleanupAudit ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: null,
      actorRole: "system",
      deletedCount: 0,
    });
    // Policy snapshot should be the env-default values (no platform_settings
    // override, no env override in the test environment).
    expect(typeof audit[0].retentionDays).toBe("number");
    expect(typeof audit[0].minRetained).toBe("number");
    expect(audit[0].cutoff).toBeInstanceOf(Date);
    expect(audit[0].createdAt).toBeInstanceOf(Date);
  });

  it("swallows transaction errors so the interval timer keeps running", async () => {
    // A crashed sweep must not take down the server's interval timer —
    // runOnce wraps everything in try/catch and logs via pino. Force the
    // transaction to reject and verify the call resolves cleanly without
    // leaving an audit row behind.
    const mod = await import("./qb-mapping-bulk-cleanup");
    const dbm = await import("@workspace/db");
    const spy = vi
      .spyOn(dbm.db, "transaction")
      .mockRejectedValueOnce(new Error("boom"));

    await expect(
      mod._runScheduledBulkActionCleanupOnce("startup"),
    ).resolves.toBeUndefined();
    expect(fixtures.qbAccountMappingCleanupAudit ?? []).toHaveLength(0);
    spy.mockRestore();
  });
});
