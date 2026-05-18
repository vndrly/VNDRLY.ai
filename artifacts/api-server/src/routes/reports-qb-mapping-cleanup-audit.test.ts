import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import {
  fixtures,
  makeDrizzleMock,
  makeReportsDbMock,
  resetMockDb,
} from "../test/mock-reports-db";

// Tests for the on-demand snapshot cleanup audit:
//   - POST /reports/qb-account-mapping/bulk-actions/cleanup with dryRun=false
//     must write one row to qb_account_mapping_cleanup_audit capturing
//     actor, deleted count, and the resolved retention policy.
//   - dryRun=true must NOT write an audit row (preview = no mutation).
//   - GET /reports/qb-account-mapping/bulk-actions/cleanup-audit must
//     return seeded audit rows joined with the actor's display name /
//     username (mirrors the bulk-actions list contract).
//
// We mock `runBulkActionCleanup` so the test focuses entirely on the
// audit-write + read paths; the cleanup helper itself has its own
// integration test (`qb-mapping-bulk-cleanup.test.ts`).

vi.mock("@workspace/db", () => makeReportsDbMock());
vi.mock("drizzle-orm", () => makeDrizzleMock());

vi.mock("../lib/reports/qb-mapping-bulk-cleanup", () => ({
  runBulkActionCleanup: vi.fn(async (opts: { dryRun?: boolean } = {}) => ({
    deleted: opts.dryRun ? 7 : 5,
    bytesFreed: opts.dryRun ? 0 : 1024,
    protectedRecent: 20,
    retentionDays: 90,
    minRetained: 20,
    cutoff: new Date("2025-01-01T00:00:00.000Z"),
    dryRun: opts.dryRun === true,
  })),
  // Used by the bulk-actions list endpoint; safe to stub since these
  // tests don't exercise it.
  getBulkActionRetentionDays: () => 90,
  computeBulkActionRetentionExpiry: (createdAt: Date) => ({
    expiresAt: createdAt,
    isExpired: false,
  }),
}));

function adminCookie(userId = 42, role = "admin"): string {
  const payload = {
    userId,
    role,
    displayName: "Audit Admin",
  };
  return buildTestCookie(payload);
}

let app: express.Express;

beforeEach(async () => {
  resetMockDb();
  vi.resetModules();
  const router = (await import("./reports")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /reports/qb-account-mapping/bulk-actions/cleanup audit row", () => {
  it("writes one audit row on a real (non-dryRun) run capturing actor + policy", async () => {
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup")
      .set("Cookie", adminCookie(123, "admin"))
      .send({});
    expectStatus(res, 200);
    expect(res.body.deleted).toBe(5);
    expect(res.body.dryRun).toBe(false);

    const audit = fixtures.qbAccountMappingCleanupAudit ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: 123,
      actorRole: "admin",
      deletedCount: 5,
      protectedRecent: 20,
      retentionDays: 90,
      minRetained: 20,
    });
    expect(audit[0].cutoff).toBeInstanceOf(Date);
    expect(audit[0].createdAt).toBeInstanceOf(Date);
  });

  it("does NOT write an audit row on a dryRun preview", async () => {
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup?dryRun=true")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.dryRun).toBe(true);
    // Preview-only call must leave the audit table untouched.
    expect(fixtures.qbAccountMappingCleanupAudit ?? []).toHaveLength(0);
  });

  it("returns 500 and does NOT leave a mismatched audit trail when the audit insert fails", async () => {
    // When the audit insert blows up (simulated DB failure), the route
    // must reject the request rather than silently returning 200 — that
    // is the whole point of wrapping cleanup + audit in a single
    // transaction. The 5xx is what tells the admin "your cleanup is in
    // an unknown state" so they can re-trigger or check logs.
    const dbModule = await import("@workspace/db");
    const realInsert = dbModule.db.insert.bind(dbModule.db);
    const insertSpy = vi
      .spyOn(dbModule.db, "insert")
      .mockImplementationOnce((t: unknown) => {
        // Only sabotage the audit insert; defer everything else to the
        // real mock. The mock table tag is the camelCase schema export
        // name (`qbAccountMappingCleanupAudit`), not the snake_case SQL
        // table name.
        if (
          typeof t === "object" &&
          t !== null &&
          (t as { __name?: string }).__name === "qbAccountMappingCleanupAudit"
        ) {
          return {
            values: () => {
              throw new Error("simulated audit insert failure");
            },
          } as never;
        }
        return realInsert(t as never);
      });

    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup")
      .set("Cookie", adminCookie())
      .send({});
    expect(res.status).toBe(500);
    // No audit row should have been written for this run.
    expect(fixtures.qbAccountMappingCleanupAudit ?? []).toHaveLength(0);
    insertSpy.mockRestore();
  });

  it("falls back to actorUserId=null when the session has no userId", async () => {
    // Build a session payload missing userId — mirrors the rare case
    // where requireAdmin is satisfied by a role-only token (admin
    // recovery flow) without an associated user record.
    const cookie = buildTestCookie({ role: "admin", displayName: "Recovery" });
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup")
      .set("Cookie", cookie)
      .send({});
    expectStatus(res, 200);
    const audit = fixtures.qbAccountMappingCleanupAudit ?? [];
    expect(audit).toHaveLength(1);
    expect(audit[0].actorUserId).toBeNull();
    expect(audit[0].actorRole).toBe("admin");
  });
});

describe("GET /reports/qb-account-mapping/bulk-actions/cleanup-audit", () => {
  it("returns seeded audit rows in reverse-chronological order", async () => {
    // The mock orderBy is order-preserving until we call .orderBy(); the
    // route does, so push rows in newest-first order to match what a real
    // desc(createdAt) query would yield.
    const base = Date.now();
    fixtures.qbAccountMappingCleanupAudit.push(
      {
        id: 3,
        actorUserId: 1,
        actorRole: "admin",
        actorDisplayName: "Alice",
        actorUsername: "alice",
        deletedCount: 12,
        protectedRecent: 20,
        retentionDays: 90,
        minRetained: 20,
        cutoff: new Date(base - 5 * 24 * 60 * 60 * 1000),
        createdAt: new Date(base - 1000),
      },
      {
        id: 2,
        actorUserId: 2,
        actorRole: "admin",
        actorDisplayName: "Bob",
        actorUsername: "bob",
        deletedCount: 0,
        protectedRecent: 20,
        retentionDays: 90,
        minRetained: 20,
        cutoff: new Date(base - 6 * 24 * 60 * 60 * 1000),
        createdAt: new Date(base - 2000),
      },
    );

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/cleanup-audit")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows[0]).toMatchObject({
      id: 3,
      actorUserId: 1,
      actorRole: "admin",
      // The mock leftJoin on usersTable is a no-op; the route still
      // surfaces actorDisplayName/actorUsername from the row's columns
      // because the in-memory db returns them as-is. A 0-deleted row
      // is preserved end-to-end (admins should see "ran but found
      // nothing" runs too).
      deletedCount: 12,
    });
    expect(res.body.rows[1]).toMatchObject({
      id: 2,
      deletedCount: 0,
    });
  });

  it("returns 403 when called without admin", async () => {
    const cookie = buildTestCookie({ userId: 1, role: "member" });
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/cleanup-audit")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.admin_required");
  });

  it("clamps limit to the [1, 100] range", async () => {
    fixtures.qbAccountMappingCleanupAudit.push({
      id: 1,
      actorUserId: null,
      actorRole: "admin",
      actorDisplayName: null,
      actorUsername: null,
      deletedCount: 1,
      protectedRecent: 20,
      retentionDays: 90,
      minRetained: 20,
      cutoff: new Date(),
      createdAt: new Date(),
    });
    // Way above the cap — must still succeed (server clamps to 100).
    const big = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/cleanup-audit?limit=10000")
      .set("Cookie", adminCookie());
    expectStatus(big, 200);
    // Garbage limit param (NaN) must fall back to the default rather than
    // returning 0 rows or a 500.
    const bad = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/cleanup-audit?limit=abc")
      .set("Cookie", adminCookie());
    expectStatus(bad, 200);
    expect(bad.body.rows).toHaveLength(1);
  });

  it("?format=csv streams the full audit log with header + per-row policy fields", async () => {
    // Seed with two rows so we can assert the CSV body has both data
    // rows and the values land in the expected columns. Use a null-actor
    // row to confirm the `who_*` columns blank out gracefully (the FK is
    // `set null`, so a deleted user account must not break the export).
    const t1 = new Date("2025-04-01T12:00:00.000Z");
    const t2 = new Date("2025-03-15T08:30:00.000Z");
    const cutoff1 = new Date("2024-12-31T00:00:00.000Z");
    const cutoff2 = new Date("2024-12-15T00:00:00.000Z");
    fixtures.qbAccountMappingCleanupAudit.push(
      {
        id: 7,
        actorUserId: 1,
        actorRole: "admin",
        actorDisplayName: "Alice Admin",
        actorUsername: "alice",
        deletedCount: 12,
        protectedRecent: 20,
        retentionDays: 90,
        minRetained: 20,
        cutoff: cutoff1,
        createdAt: t1,
      },
      {
        id: 8,
        actorUserId: null,
        actorRole: "admin",
        actorDisplayName: null,
        actorUsername: null,
        deletedCount: 0,
        protectedRecent: 20,
        retentionDays: 90,
        minRetained: 20,
        cutoff: cutoff2,
        createdAt: t2,
      },
    );

    const res = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/cleanup-audit?format=csv",
      )
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/cleanup-audit/);

    const body = res.text;
    const lines = body.trimEnd().split("\r\n");
    // Header + 2 data rows.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      [
        "when",
        "who_display_name",
        "who_username",
        "role",
        "deleted_count",
        "retention_days",
        "min_retained",
        "protected_recent",
        "cutoff",
      ].join(","),
    );
    // The named-actor row must include both display name and username
    // along with the ISO timestamp + cutoff so an offline reviewer can
    // attribute the run.
    expect(lines[1]).toContain("Alice Admin");
    expect(lines[1]).toContain("alice");
    expect(lines[1]).toContain(t1.toISOString());
    expect(lines[1]).toContain(cutoff1.toISOString());
    // The null-actor row must keep the `role` column populated so the
    // export still tells the auditor it was an admin run, even when the
    // user record was deleted.
    expect(lines[2]).toContain(",admin,");
    expect(lines[2]).toContain(t2.toISOString());
    expect(lines[2]).toContain(cutoff2.toISOString());
  });

  it("?format=csv ignores the `limit` cap and ships every row", async () => {
    // 5 seeded rows — well below the JSON path's 100-row cap, but the
    // point of this test is that the CSV path doesn't apply ANY cap, so
    // even with an explicit `limit=2` we still get all 5 rows.
    for (let i = 0; i < 5; i++) {
      fixtures.qbAccountMappingCleanupAudit.push({
        id: 100 + i,
        actorUserId: null,
        actorRole: "admin",
        actorDisplayName: null,
        actorUsername: null,
        deletedCount: i,
        protectedRecent: 20,
        retentionDays: 90,
        minRetained: 20,
        cutoff: new Date(),
        createdAt: new Date(Date.now() - i * 1000),
      });
    }

    const res = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/cleanup-audit?format=csv&limit=2",
      )
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    const lines = res.text.trimEnd().split("\r\n");
    // Header + 5 data rows — `limit=2` was deliberately ignored on the
    // CSV path.
    expect(lines).toHaveLength(6);
  });

  it("?format=csv requires admin", async () => {
    const cookie = buildTestCookie({ userId: 1, role: "member" });
    const res = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/cleanup-audit?format=csv",
      )
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.admin_required");
  });
});
