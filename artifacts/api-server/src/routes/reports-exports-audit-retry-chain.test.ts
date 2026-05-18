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
  type Row,
} from "../test/mock-reports-db";

// Tests for the retry-chain enrichment in
// GET /api/reports/exports/audit. The endpoint walks the retry graph in
// BOTH directions (parents via scope.retriedFromAuditId, children via the
// reverse lookup) so that every member of a connected component receives
// the same `retryChain` array sorted by createdAt asc, regardless of
// where in the chain the admin opened it. Out-of-window ancestors and
// descendants — as well as in-window rows hidden by the warnings filter —
// are surfaced in `chainRows` so the UI can render full chain navigation
// without a follow-up request per hop.
//
// The route exercises several edge cases that all share one piece of
// state (the union of `known` + `extras` and the BFS that builds it),
// so a regression in any one of them tends to silently break navigation
// from one end of the chain. These cases are covered here:
//
//   * single in-window chain — every member gets the full chain
//   * out-of-window root (ancestor pulled in via parent BFS)
//   * out-of-window descendant (e.g. successful retry hidden by
//     `hasWarnings=true` — the failed root in the table still needs
//     to learn about its retry to render the "Retried by #N" badge)
//   * forked chain — same row retried twice, single component, no dups
//   * cycle protection / depth cap — long ancestry is capped at
//     MAX_CHAIN_DEPTH (= 50) so a corrupted graph can't spin the request
//
// Mocks come from the shared `mock-reports-db` helper. That helper
// understands the route's `count(*)::int` selects, its
// `desc(createdAt), desc(id)` window ordering, and the two
// `sql\`${scope}->>'retriedFromAuditId'...\`` template shapes used by
// the bidirectional child fetch — none of which the simpler sibling
// audit tests need. Adding a new schema export to reports.ts only
// requires updating `reportsDbMockExports`; this suite picks it up
// automatically.

vi.mock("@workspace/db", () => makeReportsDbMock());
vi.mock("drizzle-orm", () => makeDrizzleMock());



function adminCookie(userId = 7): string {
  const payload = { userId, role: "admin", displayName: "Admin User" };
  return buildTestCookie(payload);
}

interface SeedRowOpts {
  id: number;
  retriedFromAuditId?: number | null;
  warnings?: unknown[];
  // Override createdAt for ordering control. Default derives from id so
  // larger ids are newer (matches typical real-world insertion order).
  createdAt?: Date;
}

function seedRow({
  id,
  retriedFromAuditId = null,
  warnings,
  createdAt,
}: SeedRowOpts): Row {
  const scope: Record<string, unknown> = { period: "2026-Q1" };
  if (retriedFromAuditId !== null) {
    scope.retriedFromAuditId = retriedFromAuditId;
  }
  return {
    id,
    reportKind: "qb_invoice_push",
    format: "qbo_api_push",
    scope,
    detailJson: warnings ? { warnings } : null,
    rowCount: 1,
    fileBytes: 0,
    downloadedByUserId: 1,
    userRole: "admin",
    userIp: null,
    userAgent: null,
    createdAt: createdAt ?? new Date(2026, 0, 1, 0, 0, id),
  };
}

let app: express.Express;

// Re-importing reports.ts (~large module graph) after resetModules() on a
// cold Vitest run can exceed the default 10s hookTimeout, while subsequent
// runs benefit from the transform cache. Bumped to 30s to keep cold runs
// green; healthy cold import is well under that.
beforeEach(async () => {
  resetMockDb();
  vi.resetModules();
  const router = (await import("./reports")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
}, 30_000);

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reports/exports/audit retry-chain enrichment", () => {
  it("omits retryChain entirely for a row that isn't part of any chain", async () => {
    fixtures.reportExportAuditLog.push(seedRow({ id: 10 }));

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(1);
    // Compact wire format: presence flag — omitted entirely on rows that
    // aren't actually part of any retry chain so the UI can treat the
    // field as a "this row is in a chain" boolean.
    expect(res.body.rows[0]).not.toHaveProperty("retryChain");
    expect(res.body.chainRows).toEqual([]);
  });

  it("annotates every member of a single in-window chain with the same retryChain (sorted by createdAt asc)", async () => {
    // Three-row linear chain, all in window: 30 → 31 → 32. The endpoint
    // walks the graph as undirected so the root, mid, and tip MUST all
    // receive the same chain — this is what lets an admin who opens the
    // root row see the "Retried by #32" badge as well.
    fixtures.reportExportAuditLog.push(seedRow({ id: 30 }));
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 31, retriedFromAuditId: 30 }),
    );
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 32, retriedFromAuditId: 31 }),
    );

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(3);
    const expected = [30, 31, 32];
    for (const id of expected) {
      const row = res.body.rows.find((r: Row) => r.id === id);
      expect(row, `row ${id} present`).toBeTruthy();
      expect(row.retryChain).toEqual(expected);
    }
    // chainRows is reserved for chain members the visible page can't
    // show. Everything is on-page here, so it must be empty.
    expect(res.body.chainRows).toEqual([]);
  });

  it("pulls an out-of-window ancestor into chainRows without duplicating in-window members", async () => {
    // pageSize=2 keeps the two newest rows visible. The root (id 100) is
    // older and falls outside the window — the parent BFS must fetch it
    // and surface it under chainRows so the UI can still render the full
    // chain. The in-window rows must NOT be duplicated into chainRows.
    fixtures.reportExportAuditLog.push(seedRow({ id: 100 }));
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 101, retriedFromAuditId: 100 }),
    );
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 102, retriedFromAuditId: 101 }),
    );

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=2")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(2);

    const expected = [100, 101, 102];
    const tip = res.body.rows.find((r: Row) => r.id === 102);
    const mid = res.body.rows.find((r: Row) => r.id === 101);
    expect(tip.retryChain).toEqual(expected);
    expect(mid.retryChain).toEqual(expected);

    // chainRows should contain exactly the out-of-window root, annotated
    // with the same chain so the UI doesn't have to recompute it.
    expect(res.body.chainRows).toHaveLength(1);
    expect(res.body.chainRows[0].id).toBe(100);
    expect(res.body.chainRows[0].retryChain).toEqual(expected);

    // No in-window row leaks into chainRows.
    const chainIds = res.body.chainRows.map((r: Row) => r.id);
    expect(chainIds).not.toContain(101);
    expect(chainIds).not.toContain(102);
  });

  it("surfaces an out-of-window descendant hidden by hasWarnings=true so the failed root still shows a 'Retried by #N' badge", async () => {
    // Root row (id 200) failed and carries a warning. Its retry (id 201)
    // succeeded — no warnings — so applying ?hasWarnings=true would hide
    // it from the visible rows. The endpoint must still surface the
    // hidden retry under chainRows so the visible failed root row can
    // render its "Retried by #201" badge. Both rows receive the SAME
    // retryChain because the bidirectional walk treats them as one
    // connected component.
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 200, warnings: [{ msg: "QB API push failed" }] }),
    );
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 201, retriedFromAuditId: 200 }),
    );

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10&hasWarnings=true")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    // The successful retry is hidden from `rows` by the filter…
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].id).toBe(200);
    expect(res.body.rows[0].retryChain).toEqual([200, 201]);

    // …but it MUST still be returned in chainRows so the badge can be
    // rendered. The hidden row must carry the same retryChain.
    expect(res.body.chainRows).toHaveLength(1);
    expect(res.body.chainRows[0].id).toBe(201);
    expect(res.body.chainRows[0].retryChain).toEqual([200, 201]);

    // totalWithWarnings is the unfiltered page count of warning rows —
    // exactly one (the root) — independent of whether the filter is on.
    expect(res.body.totalWithWarnings).toBe(1);
  });

  it("annotates an in-window root row with a forward chain entry pointing to its lone descendant retry tip", async () => {
    // The root (id 400) has no parent of its own — only a single newer
    // retry (id 401) — and both rows sit inside the visible window. The
    // only way the root picks up `retryChain` is via the BFS walking
    // *forward* through the children fetch. If that branch ever silently
    // regresses (e.g. the JSONB child query stops matching), the root's
    // "Retried by #401" badge would disappear without any of the
    // ancestor-direction tests catching it. This case exists to surface
    // that descendant-direction regression immediately.
    fixtures.reportExportAuditLog.push(seedRow({ id: 400 }));
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 401, retriedFromAuditId: 400 }),
    );

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(2);
    const root = res.body.rows.find((r: Row) => r.id === 400);
    const tip = res.body.rows.find((r: Row) => r.id === 401);
    expect(root, "root row 400 present").toBeTruthy();
    expect(tip, "tip row 401 present").toBeTruthy();
    // Both ends of the chain receive the SAME retryChain — the badge
    // wiring depends on this so admins can navigate from either end.
    expect(root.retryChain).toEqual([400, 401]);
    expect(tip.retryChain).toEqual([400, 401]);
    // Both members are on the visible page, so chainRows must be empty.
    expect(res.body.chainRows).toEqual([]);
  });

  it("includes the descendant retry tip in chainRows when only the root is on the visible page", async () => {
    // pageSize=1 + page=2 puts the older root (id 500) on the visible
    // page and pushes the newer retry tip (id 501) onto page 1. The
    // children-direction BFS must still discover id 501 and surface it
    // under chainRows so the root's "Retried by #501" badge can be
    // rendered without a follow-up request, even though the tip is the
    // only descendant. This complements the existing ancestor-direction
    // pagination test so a regression in either BFS direction is caught.
    fixtures.reportExportAuditLog.push(seedRow({ id: 500 }));
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 501, retriedFromAuditId: 500 }),
    );

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=1&page=2")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    // Only the older root is on this page — the newer tip lives on page 1.
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].id).toBe(500);
    expect(res.body.rows[0].retryChain).toEqual([500, 501]);

    // The descendant tip must surface in chainRows annotated with the
    // SAME retryChain so the UI's reverse index can attach the
    // "Retried by #501" badge without another request.
    expect(res.body.chainRows).toHaveLength(1);
    expect(res.body.chainRows[0].id).toBe(501);
    expect(res.body.chainRows[0].retryChain).toEqual([500, 501]);
  });

  it("treats a forked chain (same row retried twice) as a single component with one shared retryChain", async () => {
    // Row 300 was retried twice — once into 301 and again into 302.
    // The component is {300, 301, 302}; no row should appear twice and
    // every member must receive the same chain in createdAt-asc order.
    fixtures.reportExportAuditLog.push(seedRow({ id: 300 }));
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 301, retriedFromAuditId: 300 }),
    );
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 302, retriedFromAuditId: 300 }),
    );

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(3);
    const expected = [300, 301, 302];
    for (const id of expected) {
      const row = res.body.rows.find((r: Row) => r.id === id);
      expect(row, `row ${id} present`).toBeTruthy();
      expect(row.retryChain).toEqual(expected);
      // No duplicates inside the chain — the BFS visits every node once.
      expect(new Set(row.retryChain).size).toBe(row.retryChain.length);
    }
    expect(res.body.chainRows).toEqual([]);
  });

  it("dedupes shared ancestors so chainRows lists each out-of-window row exactly once", async () => {
    // Two visible tips (id 50 and id 51) both retry the same original
    // failed sync (id 10), which is itself outside the requested window.
    // The endpoint must fetch id 10 once and surface it in chainRows
    // without duplicating it per referencing tip. Since the parent edges
    // are treated as undirected when computing connected components, the
    // shared ancestor unifies the two tips into a single chain that lists
    // every member of the component (root + both retries, oldest → newest).
    fixtures.reportExportAuditLog.push(seedRow({ id: 51, retriedFromAuditId: 10 }));
    fixtures.reportExportAuditLog.push(seedRow({ id: 50, retriedFromAuditId: 10 }));
    fixtures.reportExportAuditLog.push(seedRow({ id: 10 })); // out of window

    const res = await request(app)
      .get("/api/reports/exports/audit?limit=2")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(2);
    const tipA = res.body.rows.find((r: Row) => r.id === 51);
    const tipB = res.body.rows.find((r: Row) => r.id === 50);
    // 10, 50, and 51 form one undirected component (both tips share the
    // same ancestor). Every member surfaces the full chain ordered by
    // createdAt asc.
    expect(tipA.retryChain).toEqual([10, 50, 51]);
    expect(tipB.retryChain).toEqual([10, 50, 51]);

    // Even though TWO visible rows reference id 10, it appears only
    // once in chainRows — the extras Map dedupes by id.
    const extraIds = (res.body.chainRows as Row[]).map((r) => r.id);
    expect(extraIds).toEqual([10]);
  });

  it("does not hang on a cyclic ancestry — the chain is bounded by cycle detection", async () => {
    // 50 ↔ 51 form a cycle: 50.retriedFromAuditId === 51 and vice-versa.
    fixtures.reportExportAuditLog.push(seedRow({ id: 51, retriedFromAuditId: 50 }));
    fixtures.reportExportAuditLog.push(seedRow({ id: 50, retriedFromAuditId: 51 }));

    const res = await request(app)
      .get("/api/reports/exports/audit?limit=10")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(2);
    // Each row should appear at most once in its own chain — the second
    // visit to a seen id breaks the loop instead of looping forever.
    for (const r of res.body.rows as Row[]) {
      expect(Array.isArray(r.retryChain)).toBe(true);
      const unique = new Set(r.retryChain);
      expect(unique.size).toBe(r.retryChain.length);
      // A 2-node cycle produces a chain of length 2 on each tip.
      expect(r.retryChain.length).toBeLessThanOrEqual(2);
      expect(r.retryChain).toContain(r.id);
    }
  });

  it("caps chain expansion at MAX_CHAIN_DEPTH so a long-but-valid chain never spins the request", async () => {
    // Build a 60-row linear ancestry: 1 → 2 → 3 → … → 60. With
    // MAX_CHAIN_DEPTH=50 and only the tip in the visible window, the
    // BFS adds exactly one ancestor per depth iteration and stops
    // after 50 hops — so the chain is tip + 50 ancestors = 51 ids.
    // Anything older than id 10 stays outside the chain even though it
    // exists. This is the safety valve that keeps a corrupted graph
    // from making the audit endpoint walk forever.
    const TOTAL = 60;
    for (let id = 1; id <= TOTAL; id++) {
      fixtures.reportExportAuditLog.push(
        seedRow({ id, retriedFromAuditId: id === 1 ? null : id - 1 }),
      );
    }

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=1")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(1);
    const tip = res.body.rows[0];
    expect(tip.id).toBe(TOTAL);
    expect(Array.isArray(tip.retryChain)).toBe(true);
    expect(tip.retryChain).toHaveLength(51);
    // Sorted ascending by createdAt (which mirrors id here).
    expect(tip.retryChain[0]).toBe(TOTAL - 50);
    expect(tip.retryChain[tip.retryChain.length - 1]).toBe(TOTAL);
    for (let i = 1; i < tip.retryChain.length; i++) {
      expect(tip.retryChain[i]).toBe(tip.retryChain[i - 1] + 1);
    }
    // All chain members past the visible row are surfaced in chainRows
    // (50 ancestors), and they all share the SAME retryChain that the
    // tip sees — the cap applies uniformly to every component member.
    const extraIds = (res.body.chainRows as Row[])
      .map((r) => r.id)
      .sort((a, b) => a - b);
    expect(extraIds).toEqual(tip.retryChain.slice(0, 50));
    for (const extra of res.body.chainRows as Row[]) {
      expect(extra.retryChain).toEqual(tip.retryChain);
    }
    // chainRows never duplicates the in-window tip.
    expect(extraIds).not.toContain(TOTAL);
  });

  it("does not loop on a 2-node cycle (50 ↔ 51)", async () => {
    // Cycle protection: 50 and 51 reference each other. The undirected
    // BFS marks each id as `visited` and skips revisits, so the chain
    // for each row contains both ids exactly once and the request
    // completes immediately rather than spinning forever.
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 50, retriedFromAuditId: 51 }),
    );
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 51, retriedFromAuditId: 50 }),
    );

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(2);
    for (const r of res.body.rows as Row[]) {
      expect(Array.isArray(r.retryChain)).toBe(true);
      expect(new Set(r.retryChain).size).toBe(r.retryChain.length);
      expect(r.retryChain).toEqual([50, 51]);
    }
    expect(res.body.chainRows).toEqual([]);
  });

  it("rejects non-admins with a 403 (no chain enrichment performed)", async () => {
    fixtures.reportExportAuditLog.push(seedRow({ id: 90 }));
    const cookie = buildTestCookie({ userId: 9, role: "vendor", vendorId: 1 });
    const res = await request(app)
      .get("/api/reports/exports/audit")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.admin_required");
  });
});

// Pagination, anchor jumps, and warnings-filter behaviour. These are the
// features that make task #328 ("page through audit log entries older than
// the last 100") work end-to-end: the UI uses page=N to walk backwards in
// time, anchorId to follow a "Retry of #N" badge whose target row landed on
// another page, and hasWarnings=true to focus on the rows that need triage
// (with totalWithWarnings still computed over the unfiltered current page
// so the header badge stays meaningful).
describe("GET /api/reports/exports/audit pagination & filters", () => {
  // Seed N rows newest-first (id=N has the latest createdAt). Order in the
  // fixture array is what the in-memory mock returns, mirroring what the
  // route would see after .orderBy(desc(createdAt)).
  function seedNewestFirst(count: number): void {
    for (let id = count; id >= 1; id--) {
      fixtures.reportExportAuditLog.push(seedRow({ id }));
    }
  }

  it("returns the first page (newest rows) when no page is specified and reports the total count", async () => {
    seedNewestFirst(250);

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=100")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(100);
    expect(res.body.totalRows).toBe(250);
    expect(res.body.rows).toHaveLength(100);
    // Newest first: ids 250..151.
    expect(res.body.rows[0].id).toBe(250);
    expect(res.body.rows[res.body.rows.length - 1].id).toBe(151);
  });

  it("returns subsequent pages so admins can walk back past the most-recent 100", async () => {
    seedNewestFirst(250);

    const page2 = await request(app)
      .get("/api/reports/exports/audit?pageSize=100&page=2")
      .set("Cookie", adminCookie());
    expectStatus(page2, 200);
    expect(page2.body.page).toBe(2);
    expect(page2.body.totalRows).toBe(250);
    expect(page2.body.rows).toHaveLength(100);
    expect(page2.body.rows[0].id).toBe(150);
    expect(page2.body.rows[page2.body.rows.length - 1].id).toBe(51);

    const page3 = await request(app)
      .get("/api/reports/exports/audit?pageSize=100&page=3")
      .set("Cookie", adminCookie());
    expectStatus(page3, 200);
    expect(page3.body.page).toBe(3);
    expect(page3.body.rows).toHaveLength(50);
    expect(page3.body.rows[0].id).toBe(50);
    expect(page3.body.rows[page3.body.rows.length - 1].id).toBe(1);
  });

  it("treats the legacy `limit` query param as the page size (page defaults to 1)", async () => {
    seedNewestFirst(60);
    const res = await request(app)
      .get("/api/reports/exports/audit?limit=25")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(25);
    expect(res.body.rows).toHaveLength(25);
    expect(res.body.totalRows).toBe(60);
  });

  it("`anchorId` resolves to the page that contains the row and echoes anchorId in the response", async () => {
    seedNewestFirst(250);
    // Row id=120 sits on page 2 (rows 150..51) when pageSize=100 — the
    // server should compute that for us so admins clicking a "Retry of
    // #120" badge land on the right page without manual paging.
    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=100&anchorId=120")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.page).toBe(2);
    expect(res.body.anchorId).toBe(120);
    expect(res.body.anchorOutsideFilter).toBeUndefined();
    expect(res.body.rows.some((r: Row) => r.id === 120)).toBe(true);
  });

  it("`anchorId` resolves to a chain member's page and the anchored row carries its retryChain (anchorOutsideFilter stays unset)", async () => {
    // Three-row linear chain (600 → 601 → 602) all in window. Anchoring
    // to the middle node must:
    //   * resolve the page that contains it (page 1 here, pageSize=10),
    //   * echo anchorId in the response,
    //   * leave anchorOutsideFilter UNSET because the anchor row exists,
    //   * still annotate the anchor row with the FULL chain so the
    //     "Retry of #N" / "Retried by #N" badges work on the deep-linked
    //     row — the chain enrichment must compose with anchor resolution.
    fixtures.reportExportAuditLog.push(seedRow({ id: 600 }));
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 601, retriedFromAuditId: 600 }),
    );
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 602, retriedFromAuditId: 601 }),
    );

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10&anchorId=601")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.anchorId).toBe(601);
    // The flag is reserved for ids that don't exist under the active
    // filter — a chain member that exists must NOT trigger it.
    expect(res.body.anchorOutsideFilter).toBeUndefined();
    expect(res.body.page).toBe(1);
    const anchored = res.body.rows.find((r: Row) => r.id === 601);
    expect(anchored, "anchor row 601 present in visible rows").toBeTruthy();
    expect(anchored.retryChain).toEqual([600, 601, 602]);
  });

  it("`anchorId` falls back to page 1 with anchorOutsideFilter=true when the target row is filtered out", async () => {
    // Only one warning-bearing row exists; anchoring to a different id
    // under hasWarnings=true must not crash and must signal the UI to
    // surface a 'this id is hidden by your filter' banner.
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 5, warnings: [{ kind: "x" }] }),
    );
    fixtures.reportExportAuditLog.push(seedRow({ id: 3 }));

    const res = await request(app)
      .get(
        "/api/reports/exports/audit?pageSize=100&hasWarnings=true&anchorId=3",
      )
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    // Even though hasWarnings filters the visible rows on the page, the
    // anchor lookup runs against the UNFILTERED window — id=3 exists, so
    // we should resolve to its page (page 1 here) rather than flag it as
    // "outside filter". The flag is reserved for ids that genuinely don't
    // exist in the date-filtered window.
    expect(res.body.page).toBe(1);
    expect(res.body.anchorId).toBe(3);
  });

  it("`anchorId` flags anchorOutsideFilter when no row matches the given id under the active date filter", async () => {
    // Seed a row in Jan 2026; anchor to a non-existent id under a
    // narrow date filter so the anchor lookup misses entirely.
    fixtures.reportExportAuditLog.push(seedRow({ id: 7 }));
    const res = await request(app)
      .get(
        "/api/reports/exports/audit?pageSize=100&anchorId=999&from=2026-01-01T00:00:00.000Z&to=2026-12-31T23:59:59.999Z",
      )
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.anchorOutsideFilter).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.anchorId).toBe(999);
  });

  it("`hasWarnings=true` hides clean rows but keeps the 'with warnings' badge count over the unfiltered page", async () => {
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 30, warnings: [{ kind: "a" }] }),
    );
    fixtures.reportExportAuditLog.push(seedRow({ id: 29 }));
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 28, warnings: [{ kind: "b" }, { kind: "c" }] }),
    );
    fixtures.reportExportAuditLog.push(seedRow({ id: 27 }));

    const filtered = await request(app)
      .get("/api/reports/exports/audit?pageSize=10&hasWarnings=true")
      .set("Cookie", adminCookie());
    expectStatus(filtered, 200);
    // Visible rows on the page: only the two with warnings.
    expect(filtered.body.rows.map((r: Row) => r.id).sort()).toEqual([28, 30]);
    // totalWithWarnings is the count over the *unfiltered* current page —
    // both 28 and 30 have warnings, so it's 2 either way here. The key
    // contract is that it doesn't drop to 0 just because the toggle is on.
    expect(filtered.body.totalWithWarnings).toBe(2);
    // totalRows reflects every row in the date window, not just the
    // warning-bearing ones — admins still see how big the full history is.
    expect(filtered.body.totalRows).toBe(4);

    const unfiltered = await request(app)
      .get("/api/reports/exports/audit?pageSize=10")
      .set("Cookie", adminCookie());
    expect(unfiltered.body.rows).toHaveLength(4);
    expect(unfiltered.body.totalWithWarnings).toBe(2);
  });

  it("`hasWarnings=true` still surfaces the no-warning retry tip in chainRows so 'Retried by #N' badges keep linking", async () => {
    // Original failed sync at id=10 carried warnings; the successful
    // retry at id=11 has none. With hasWarnings=true the table only
    // shows id=10, but the UI still needs to know about id=11 so it can
    // render a clickable "Retried by #11" badge on row 10. The endpoint
    // must surface id=11 in chainRows even though it's filtered out of
    // the visible row list.
    fixtures.reportExportAuditLog.push(seedRow({ id: 11, retriedFromAuditId: 10 }));
    fixtures.reportExportAuditLog.push(
      seedRow({ id: 10, warnings: [{ kind: "row_failed" }] }),
    );

    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=10&hasWarnings=true")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows.map((r: Row) => r.id)).toEqual([10]);
    // The successful retry must be in chainRows so the UI's reverse
    // index can still attach a "Retried by #11" badge to row 10.
    const chainIds = (res.body.chainRows as Row[]).map((r) => r.id);
    expect(chainIds).toContain(11);
  });

  it("clamps pageSize at 500 by rejecting larger values", async () => {
    seedNewestFirst(5);
    const res = await request(app)
      .get("/api/reports/exports/audit?pageSize=1000")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation.invalid_query");
  });
});
