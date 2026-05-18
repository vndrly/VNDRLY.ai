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

// Tests for POST /reports/qb-account-mapping/bulk-actions/cleanup, the
// admin-only "run the retention sweep right now" endpoint.
//
// The handler accepts a `dryRun` flag from EITHER the query string OR the
// JSON body, and on a real (non-preview) run it wraps the cleanup helper
// + audit insert in a single transaction. The response shape is
// load-bearing: the Reports admin UI shows the `deleted` /
// `protectedRecent` counts to confirm "would delete N rows" before the
// admin clicks apply, and a regression in the dryRun parsing or in any
// of the surfaced policy fields (`retentionDays`, `minRetained`,
// `cutoff`) could quietly delete more rows than the preview promised.
//
// A sibling spec (`reports-qb-mapping-cleanup-audit.test.ts`) pins down
// the audit-row write/read paths. This file focuses on the dryRun
// branching, the response contract, the 500 path when the underlying
// worker throws, and the admin gate — i.e. everything the route owns
// independent of the audit table.

vi.mock("@workspace/db", () => makeReportsDbMock());
vi.mock("drizzle-orm", () => makeDrizzleMock());

// Fixed cutoff so the response-shape assertions can compare against a
// known ISO string. The handler calls `result.cutoff.toISOString()`, so
// the wire field is always a string regardless of how the worker
// constructs the Date.
const FIXED_CUTOFF = new Date("2025-02-15T00:00:00.000Z");

// Module-scoped spy so individual tests can assert how the route invoked
// the worker (specifically: was `dryRun` set?). The factory below
// re-exports it so production code resolves to the same mock.
const runBulkActionCleanupMock = vi.fn(
  async (opts: { dryRun?: boolean } = {}) => ({
    deleted: opts.dryRun ? 12 : 9,
    bytesFreed: opts.dryRun ? 0 : 4096,
    protectedRecent: 20,
    retentionDays: 90,
    minRetained: 20,
    cutoff: FIXED_CUTOFF,
    dryRun: opts.dryRun === true,
  }),
);

vi.mock("../lib/reports/qb-mapping-bulk-cleanup", () => ({
  runBulkActionCleanup: runBulkActionCleanupMock,
  // Stubs for the bulk-actions LIST endpoint that also lives in
  // reports.ts; this spec doesn't exercise it but the imports are
  // resolved at module load.
  getBulkActionRetentionDays: () => 90,
  getBulkActionExpiresSoonDays: () => 7,
  computeBulkActionRetentionExpiry: (createdAt: Date) => ({
    expiresAt: createdAt,
    isExpired: false,
    expiresSoon: false,
  }),
}));

function adminCookie(userId = 42): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Cleanup Admin",
  });
}

let app: express.Express;

beforeEach(async () => {
  resetMockDb();
  vi.resetModules();
  runBulkActionCleanupMock.mockClear();
  // Restore the default success implementation in case a prior test
  // (e.g. the 500 path) replaced it.
  runBulkActionCleanupMock.mockImplementation(
    async (opts: { dryRun?: boolean } = {}) => ({
      deleted: opts.dryRun ? 12 : 9,
      bytesFreed: opts.dryRun ? 0 : 4096,
      protectedRecent: 20,
      retentionDays: 90,
      minRetained: 20,
      cutoff: FIXED_CUTOFF,
      dryRun: opts.dryRun === true,
    }),
  );
  const router = (await import("./reports")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  // Silence the expected error-path log so the test output stays clean
  // when we assert the 500 branch below.
  attachTestErrorMiddleware(app, { logErrors: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/reports/qb-account-mapping/bulk-actions/cleanup", () => {
  it("treats ?dryRun=true on the query string as a preview (no audit row, no body required)", async () => {
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup?dryRun=true")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);

    // The worker must have been invoked with `dryRun: true` so it skips
    // the actual DELETE.
    expect(runBulkActionCleanupMock).toHaveBeenCalledTimes(1);
    expect(runBulkActionCleanupMock).toHaveBeenCalledWith({ dryRun: true });

    // The response surfaces every policy field the UI needs to render
    // the "would delete N rows" confirmation.
    expect(res.body).toEqual({
      ok: true,
      dryRun: true,
      deleted: 12,
      bytesFreed: 0,
      protectedRecent: 20,
      retentionDays: 90,
      minRetained: 20,
      cutoff: FIXED_CUTOFF.toISOString(),
    });

    // Preview must NOT touch the audit table — that contract is what
    // makes "preview" safe to call from a banner / hover.
    expect(fixtures.qbAccountMappingCleanupAudit ?? []).toHaveLength(0);
  });

  it("treats { dryRun: true } in the JSON body as a preview (the UI sends this shape from fetch)", async () => {
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup")
      .set("Cookie", adminCookie())
      .send({ dryRun: true });
    expectStatus(res, 200);

    expect(runBulkActionCleanupMock).toHaveBeenCalledTimes(1);
    expect(runBulkActionCleanupMock).toHaveBeenCalledWith({ dryRun: true });
    expect(res.body.dryRun).toBe(true);
    expect(res.body.deleted).toBe(12);
    expect(fixtures.qbAccountMappingCleanupAudit ?? []).toHaveLength(0);
  });

  it("runs the apply path when dryRun is omitted and surfaces the post-delete counts", async () => {
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup")
      .set("Cookie", adminCookie())
      .send({});
    expectStatus(res, 200);

    // Apply path goes through the transaction wrapper and passes an
    // `executor: tx` into the worker. We only assert on `dryRun: false`
    // here — the executor is an opaque object and is exercised by the
    // sibling audit spec.
    expect(runBulkActionCleanupMock).toHaveBeenCalledTimes(1);
    const callArgs = runBulkActionCleanupMock.mock.calls[0]?.[0] ?? {};
    expect(callArgs.dryRun).toBe(false);

    expect(res.body).toMatchObject({
      ok: true,
      dryRun: false,
      deleted: 9,
      bytesFreed: 4096,
      protectedRecent: 20,
      retentionDays: 90,
      minRetained: 20,
      cutoff: FIXED_CUTOFF.toISOString(),
    });

    // Apply path must leave a single audit row — this is the contract
    // that a real cleanup is always traceable.
    expect(fixtures.qbAccountMappingCleanupAudit).toHaveLength(1);
  });

  it("treats stringy / numeric truthy dryRun values from the query as a preview", async () => {
    // The handler accepts the literal strings "true" and "1" because
    // query params arrive as strings; assert both shapes route into the
    // preview branch so a future tightening of the parse doesn't break
    // the existing UI links.
    const resTrue = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup?dryRun=true")
      .set("Cookie", adminCookie());
    expectStatus(resTrue, 200);
    expect(resTrue.body.dryRun).toBe(true);

    const resOne = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup?dryRun=1")
      .set("Cookie", adminCookie());
    expectStatus(resOne, 200);
    expect(resOne.body.dryRun).toBe(true);

    // Neither preview should have written an audit row.
    expect(fixtures.qbAccountMappingCleanupAudit ?? []).toHaveLength(0);
  });

  it("returns 500 when the underlying worker throws and never writes an audit row", async () => {
    runBulkActionCleanupMock.mockImplementationOnce(async () => {
      throw new Error("simulated retention worker failure");
    });

    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup")
      .set("Cookie", adminCookie())
      .send({});
    // Response must be a 500 with the route's stable error code so the
    // UI can surface a "cleanup failed — try again" toast.
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: "Cleanup failed",
      code: "report.cleanup_failed",
    });

    // No audit row should have been written for a failed run — the
    // transaction wrapper's whole point is "all or nothing".
    expect(fixtures.qbAccountMappingCleanupAudit ?? []).toHaveLength(0);
  });

  it("rejects non-admins with 403 and never invokes the worker", async () => {
    const cookie = buildTestCookie({
      userId: 5,
      role: "vendor",
      vendorId: 1,
    });
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/cleanup")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(403);
    // The admin gate must short-circuit before we ever touch the
    // retention worker — otherwise a non-admin could race a transaction
    // open even on a rejected request.
    expect(runBulkActionCleanupMock).not.toHaveBeenCalled();
    expect(fixtures.qbAccountMappingCleanupAudit ?? []).toHaveLength(0);
  });
});
