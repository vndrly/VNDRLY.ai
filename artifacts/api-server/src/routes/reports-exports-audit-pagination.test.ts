import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  attachTestErrorMiddleware,
  expectStatus,
} from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import {
  fixtures,
  makeDrizzleMock,
  makeReportsDbMock,
  resetMockDb,
  type Row,
} from "../test/mock-reports-db";

// Tests for the pagination, date-range filter, and Go-to-ID anchor jump
// behaviour of GET /api/reports/exports/audit. The retry-chain enrichment
// has its own suite (`reports-exports-audit-retry-chain.test.ts`) that
// covers some pagination ground transitively, but the page-math itself —
// default page size, custom page navigation, the 500-row clamp, anchor
// resolution at the boundaries, the `anchorOutsideFilter` flag, the
// legacy `?limit=` alias, and the `from`/`to` validation — was previously
// only verified by manual checks. An off-by-one regression here (we
// already hit one caused by JS Date millisecond rounding vs. Postgres
// microsecond timestamps) would silently break the admin's "Page X of Y"
// navigation, so this suite locks the contract in place.
//
// Mocks come from the shared `mock-reports-db` helper. The drizzle-orm
// mock there now recognises `gte(col, Date)` / `lt(col, Date)` for the
// date-range filter, and the `sql\`(createdAt, id) > (SELECT created_at,
// id FROM <table> WHERE id = <anchorId>)\`` template the route uses to
// resolve which page contains an anchor row in `desc(createdAt, id)`
// sort order — including the tuple tie-break on `id` for rows that share
// a `createdAt` to the millisecond.

vi.mock("@workspace/db", () => makeReportsDbMock());
vi.mock("drizzle-orm", () => makeDrizzleMock());

function adminCookie(userId = 7): string {
  const payload = { userId, role: "admin", displayName: "Admin User" };
  return buildTestCookie(payload);
}

interface SeedRowOpts {
  id: number;
  createdAt?: Date;
}

function seedRow({ id, createdAt }: SeedRowOpts): Row {
  return {
    id,
    reportKind: "qb_invoice_push",
    format: "qbo_api_push",
    scope: { period: "2026-Q1" },
    detailJson: null,
    rowCount: 1,
    fileBytes: 0,
    downloadedByUserId: 1,
    userRole: "admin",
    userIp: null,
    userAgent: null,
    // Default: id maps to a per-second offset so larger ids are newer.
    createdAt: createdAt ?? new Date(2026, 0, 1, 0, 0, id),
  };
}

// Insert N rows so the fixture array order alone wouldn't yield the
// correct desc(createdAt, id) result — the route MUST be the one
// producing the ordering. We push oldest-first here; the in-memory mock
// then sorts by `desc(createdAt), desc(id)` when `.orderBy(...)` is
// called.
function seedOldestFirst(count: number): void {
  for (let id = 1; id <= count; id++) {
    fixtures.reportExportAuditLog.push(seedRow({ id }));
  }
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

describe("GET /api/reports/exports/audit default pagination", () => {
  it("uses the default page size (100) and orders newest-first by (createdAt desc, id desc)", async () => {
    seedOldestFirst(150);

    const res = await request(app)
      .get("/api/reports/exports/audit")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(100);
    expect(res.body.totalRows).toBe(150);
    expect(res.body.rows).toHaveLength(100);
    // Newest 100 rows: ids 150..51 in descending order.
    expect(res.body.rows[0].id).toBe(150);
    expect(res.body.rows[res.body.rows.length - 1].id).toBe(51);
    // Strictly descending (no in-page reorderings).
    for (let i = 1; i < res.body.rows.length; i++) {
      expect(res.body.rows[i].id).toBeLessThan(res.body.rows[i - 1].id);
    }
  });

  it("breaks createdAt ties by id (desc) so two rows sharing a millisecond don't shuffle", async () => {
    // Three rows all sharing the same createdAt — id desc must control
    // the order so admins never see a flapping list under load.
    const sameTs = new Date("2026-04-01T12:00:00.000Z");
    fixtures.reportExportAuditLog.push(seedRow({ id: 1, createdAt: sameTs }));
    fixtures.reportExportAuditLog.push(seedRow({ id: 3, createdAt: sameTs }));
    fixtures.reportExportAuditLog.push(seedRow({ id: 2, createdAt: sameTs }));

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows.map((r: Row) => r.id)).toEqual([3, 2, 1]);
  });
});

describe("GET /api/reports/exports/audit custom page & pageSize", () => {
  it("returns the requested page slice for a custom pageSize", async () => {
    seedOldestFirst(60);

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=20&page=2")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.page).toBe(2);
    expect(res.body.pageSize).toBe(20);
    expect(res.body.totalRows).toBe(60);
    expect(res.body.rows).toHaveLength(20);
    // Page 2 of newest-first: ids 40..21.
    expect(res.body.rows[0].id).toBe(40);
    expect(res.body.rows[res.body.rows.length - 1].id).toBe(21);
  });

  it("rejects pageSize > 500 with a 400 (the documented hard cap)", async () => {
    seedOldestFirst(5);
    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=501")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation.invalid_query");
  });

  it("accepts pageSize=500 (the boundary value, inclusive)", async () => {
    seedOldestFirst(5);
    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=500")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.pageSize).toBe(500);
  });
});

describe("GET /api/reports/exports/audit anchor-jump page resolution", () => {
  it("lands on the page that actually contains the requested row (mid-list)", async () => {
    seedOldestFirst(60);
    // pageSize=10 + newest-first: id=60 on p1, 50 on p2, …, id=25 on p4.
    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10&anchorId=25")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.anchorId).toBe(25);
    expect(res.body.anchorOutsideFilter).toBeUndefined();
    expect(res.body.page).toBe(4);
    expect(res.body.rows.some((r: Row) => r.id === 25)).toBe(true);
  });

  it("anchors to the OLDEST row — lands on the last page, not page 1", async () => {
    // Edge case: anchor to id=1 (the oldest row). With 60 rows and
    // pageSize=10, the oldest row sits at the bottom of page 6.
    // Off-by-one regressions in the newer-than-anchor count typically
    // surface here as "page 7" (count includes the anchor itself).
    seedOldestFirst(60);
    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10&anchorId=1")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.page).toBe(6);
    expect(res.body.rows.some((r: Row) => r.id === 1)).toBe(true);
  });

  it("anchors to the NEWEST row — lands on page 1", async () => {
    // Edge case: anchor to id=60 (the newest row). Zero rows are newer,
    // so floor(0 / pageSize) + 1 = 1 must be the resolved page.
    seedOldestFirst(60);
    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10&anchorId=60")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.page).toBe(1);
    expect(res.body.rows[0].id).toBe(60);
  });

  it("uses the (createdAt, id) tuple tie-break so anchoring on a tied-createdAt row lands on the right page", async () => {
    // Five rows all sharing the same createdAt — desc(createdAt, id)
    // ordering must put them on pages as 5,4 / 3,2 / 1 (pageSize=2).
    // Anchoring to id=1 (the OLDEST in the tie) must resolve to page 3,
    // not page 1. This is the JS-Date-vs-Postgres-microsecond regression
    // the route's SQL tuple-comparison subquery exists to prevent.
    const sameTs = new Date("2026-04-01T12:00:00.000Z");
    for (const id of [1, 2, 3, 4, 5]) {
      fixtures.reportExportAuditLog.push(seedRow({ id, createdAt: sameTs }));
    }

    const anchorOldest = await request(app)
      .get("/api/reports/exports/audit?pageSize=2&anchorId=1")
      .set("Cookie", adminCookie());
    expectStatus(anchorOldest, 200);
    expect(anchorOldest.body.page).toBe(3);
    expect(anchorOldest.body.rows.some((r: Row) => r.id === 1)).toBe(true);

    // Anchoring to id=3 (middle of the tie) must land on page 2 —
    // exactly two ids (5, 4) are "newer" under (createdAt, id) desc.
    const anchorMid = await request(app)
      .get("/api/reports/exports/audit?pageSize=2&anchorId=3")
      .set("Cookie", adminCookie());
    expectStatus(anchorMid, 200);
    expect(anchorMid.body.page).toBe(2);
    expect(anchorMid.body.rows.some((r: Row) => r.id === 3)).toBe(true);
  });
});

describe("GET /api/reports/exports/audit anchorOutsideFilter signal", () => {
  it("flags anchorOutsideFilter when the anchor row is filtered out by the from/to date range", async () => {
    // Two rows two months apart. A from/to window that includes only the
    // newer row, anchored on the older one → the anchor lookup misses,
    // the route falls back to page 1 and signals the UI via
    // anchorOutsideFilter so a "this id is outside your filter" banner
    // can be rendered instead of silently jumping somewhere unrelated.
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 1, createdAt: new Date("2026-01-15T12:00:00.000Z") }),
    );
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 2, createdAt: new Date("2026-06-15T12:00:00.000Z") }),
    );

    const res = await request(app)
      .get(
        "/api/reports/exports/audit?pageSize=10&anchorId=1&from=2026-05-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z",
      )
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.anchorOutsideFilter).toBe(true);
    expect(res.body.anchorId).toBe(1);
    expect(res.body.page).toBe(1);
    // The visible page reflects the date filter — only the in-window row.
    expect(res.body.rows.map((r: Row) => r.id)).toEqual([2]);
    expect(res.body.totalRows).toBe(1);
  });

  it("flags anchorOutsideFilter when no row exists for the given anchorId", async () => {
    seedOldestFirst(5);
    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10&anchorId=9999")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.anchorOutsideFilter).toBe(true);
    expect(res.body.anchorId).toBe(9999);
    expect(res.body.page).toBe(1);
  });
});

describe("GET /api/reports/exports/audit date-range filter", () => {
  it("applies from/to as a half-open window on createdAt (inclusive from, exclusive to)", async () => {
    // Rows spanning Jan, Feb, Mar 2026. The window [Feb, Mar) must
    // include only the Feb row — Jan is older than `from`, Mar is at/
    // after the exclusive `to`.
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 1, createdAt: new Date("2026-01-15T00:00:00.000Z") }),
    );
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 2, createdAt: new Date("2026-02-15T00:00:00.000Z") }),
    );
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 3, createdAt: new Date("2026-03-01T00:00:00.000Z") }),
    );

    const res = await request(app)
      .get(
        "/api/reports/exports/audit?from=2026-02-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z",
      )
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.totalRows).toBe(1);
    expect(res.body.rows.map((r: Row) => r.id)).toEqual([2]);
  });
});

describe("GET /api/reports/exports/audit legacy ?limit= alias", () => {
  it("treats `limit` as the page size when `pageSize` is omitted (page defaults to 1)", async () => {
    seedOldestFirst(40);
    const res = await request(app)
      .get("/api/reports/exports/audit?limit=15")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(15);
    expect(res.body.rows).toHaveLength(15);
    expect(res.body.totalRows).toBe(40);
    // Newest first: ids 40..26.
    expect(res.body.rows[0].id).toBe(40);
    expect(res.body.rows[res.body.rows.length - 1].id).toBe(26);
  });

  it("prefers `pageSize` over `limit` when both are supplied", async () => {
    seedOldestFirst(20);
    const res = await request(app)
      .get("/api/reports/exports/audit?limit=5&pageSize=10")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.pageSize).toBe(10);
    expect(res.body.rows).toHaveLength(10);
  });
});

describe("GET /api/reports/exports/audit input validation", () => {
  it("rejects an invalid `from` timestamp with a 400", async () => {
    const res = await request(app)
      .get("/api/reports/exports/audit?from=not-a-date")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation.invalid_query");
  });

  it("rejects an invalid `to` timestamp with a 400", async () => {
    const res = await request(app)
      .get("/api/reports/exports/audit?to=2026-13-99T99:99:99Z")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
  });

  it("rejects a negative or zero pageSize with a 400", async () => {
    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=0")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
  });
});
