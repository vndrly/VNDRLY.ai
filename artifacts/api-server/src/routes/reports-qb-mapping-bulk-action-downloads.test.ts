import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import {
  makeReportsDbTables,
  reportsDbModuleExports,
} from "../test/reportsDbMockExports";

// Tests for GET /reports/qb-account-mapping/bulk-actions/:id/downloads
// — the per-bulk-action download audit list that surfaces "which
// admin/accountant downloaded the snapshot CSV". Backed by
// `report_export_audit_log` rows whose
// `reportKind = 'admin.qbMapping.bulkActionDetails'` and
// `scope.bulkActionId = :id`.

type Row = Record<string, any>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "inArray"; col: ColRef; vals: any[] }
  | { kind: "and"; preds: Pred[] }
  | { kind: "scope"; key: string; val: any }
  | { kind: "true" };

const tables = await makeReportsDbTables();

const fixtures: Record<string, Row[]> = {
  qbAccountMappingBulkActions: [],
  reportExportAuditLog: [],
  vendors: [],
  partners: [],
  users: [],
};

function evalPred(pred: Pred | undefined, row: Row): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case "true":
      return true;
    case "eq":
      return row[pred.col.__col] === pred.val;
    case "isNull":
      return row[pred.col.__col] == null;
    case "inArray":
      return pred.vals.includes(row[pred.col.__col]);
    case "scope":
      return String(row?.scope?.[pred.key] ?? "") === String(pred.val);
    case "and":
      return pred.preds.every((p) => evalPred(p, row));
  }
}

function makeQuery(tableName: string, joinedTables: string[] = []) {
  let pred: Pred | undefined;
  let limitN: number | undefined;
  const run = () => {
    const all = fixtures[tableName] ?? [];
    const filtered = all.filter((r) => evalPred(pred, r)).map((r) => {
      const out: Row = { ...r };
      if (joinedTables.includes("users")) {
        const userId =
          r.downloadedByUserId ?? r.actorUserId ?? null;
        const u = (fixtures.users ?? []).find((x) => x.id === userId);
        out.downloadedByDisplayName = u?.displayName ?? null;
        out.downloadedByUsername = u?.username ?? null;
        out.actorDisplayName = u?.displayName ?? null;
        out.actorUsername = u?.username ?? null;
      }
      return out;
    });
    // newest-first to mirror the route's `desc(createdAt)`.
    if (tableName === "reportExportAuditLog") {
      filtered.sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        return tb - ta;
      });
    }
    return limitN != null ? filtered.slice(0, limitN) : filtered;
  };
  const q: any = {
    where: (p: Pred) => {
      pred = p;
      return q;
    },
    leftJoin: (t: any) => {
      joinedTables.push(t.__name);
      return q;
    },
    innerJoin: () => q,
    orderBy: () => q,
    limit: (n: number) => {
      limitN = n;
      return q;
    },
    then: (resolve: any, reject?: any) =>
      Promise.resolve(run()).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(run()).catch(reject),
  };
  return q;
}

vi.mock("@workspace/db", async () => {
  const db = {
    select: () => ({
      from: (t: any) => makeQuery(t.__name),
    }),
    insert: (t: any) => ({
      values: (v: any) => {
        if (!fixtures[t.__name]) fixtures[t.__name] = [];
        const row = { id: fixtures[t.__name].length + 1, ...v };
        fixtures[t.__name].push(row);
        return { returning: async () => [row] };
      },
    }),
    update: (t: any) => ({
      set: (s: Row) => ({
        where: (pred: Pred) => ({
          returning: async () => {
            const all = fixtures[t.__name] ?? [];
            const updated: Row[] = [];
            for (const r of all) {
              if (evalPred(pred, r)) {
                Object.assign(r, s);
                updated.push(r);
              }
            }
            return updated;
          },
        }),
      }),
    }),
    delete: () => ({ where: () => ({ returning: async () => [] }) }),
    transaction: async (cb: (tx: any) => any) => cb(db),
    execute: async () => ({ rows: [] }),
  };
  return {
    db,
    ...(await reportsDbModuleExports(tables)),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  // sql tag: detect the `scope->>'bulkActionId' = ${id}` template the route
  // uses and turn it into a structured `scope` predicate the in-memory
  // store can evaluate. Anything else falls through as `true`.
  const sqlTag: any = (strings: TemplateStringsArray, ...values: any[]) => {
    try {
      const joined = strings.join("?");
      const m = joined.match(/->>'([^']+)'\s*=\s*\?/);
      if (m && values.length >= 1) {
        return { kind: "scope", key: m[1], val: values[values.length - 1] };
      }
    } catch {
      /* fall through */
    }
    return { kind: "true" };
  };
  sqlTag.raw = passthrough;
  return {
    and: (...preds: Pred[]) => ({ kind: "and", preds: preds.filter(Boolean) }),
    eq: (col: ColRef, val: any) => ({ kind: "eq", col, val }),
    isNull: (col: ColRef) => ({ kind: "isNull", col }),
    isNotNull: passthrough,
    inArray: (col: ColRef, vals: any[]) => ({ kind: "inArray", col, vals }),
    sql: sqlTag,
    desc: passthrough,
    gte: passthrough,
    gt: passthrough,
    lt: passthrough,
    lte: passthrough,
    or: passthrough,
  };
});

function adminCookie(userId = 7): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin",
  });
}

let app: express.Express;

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
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

describe("GET /api/reports/qb-account-mapping/bulk-actions/:id/downloads", () => {
  it("returns every CSV download for the bulk action with downloader name resolved, newest first", async () => {
    fixtures.users.push(
      { id: 7, displayName: "Alice Admin", username: "alice" },
      { id: 8, displayName: "Bob Accountant", username: "bob" },
    );
    // Two downloads for bulk action #42 by different admins, plus one
    // unrelated audit row for action #99 that must NOT leak into the
    // response.
    fixtures.reportExportAuditLog.push(
      {
        id: 1,
        reportKind: "admin.qbMapping.bulkActionDetails",
        format: "csv",
        scope: { bulkActionId: 42, kind: "csv_import" },
        downloadedByUserId: 7,
        userRole: "admin",
        createdAt: new Date("2026-04-01T10:00:00Z"),
      },
      {
        id: 2,
        reportKind: "admin.qbMapping.bulkActionDetails",
        format: "csv",
        scope: { bulkActionId: 42, kind: "csv_import" },
        downloadedByUserId: 8,
        userRole: "admin",
        createdAt: new Date("2026-04-02T11:30:00Z"),
      },
      {
        id: 3,
        reportKind: "admin.qbMapping.bulkActionDetails",
        format: "csv",
        scope: { bulkActionId: 99, kind: "bulk_apply" },
        downloadedByUserId: 7,
        userRole: "admin",
        createdAt: new Date("2026-04-03T12:00:00Z"),
      },
    );

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/42/downloads")
      .set("Cookie", adminCookie());

    expectStatus(res, 200);
    expect(res.body.bulkActionId).toBe(42);
    expect(res.body.downloadCount).toBe(2);
    expect(res.body.downloads).toHaveLength(2);
    // newest first
    expect(res.body.downloads[0]).toMatchObject({
      id: 2,
      downloadedByUserId: 8,
      downloadedByDisplayName: "Bob Accountant",
      downloadedByUsername: "bob",
      userRole: "admin",
    });
    expect(res.body.downloads[1]).toMatchObject({
      id: 1,
      downloadedByUserId: 7,
      downloadedByDisplayName: "Alice Admin",
      downloadedByUsername: "alice",
    });
  });

  it("returns an empty list when nothing has been downloaded yet", async () => {
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/42/downloads")
      .set("Cookie", adminCookie());

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      bulkActionId: 42,
      downloadCount: 0,
      downloads: [],
    });
  });

  it("ignores audit rows for unrelated report kinds even when the scope id matches", async () => {
    // Same bulkActionId but a different reportKind (e.g. cleanup audit
    // download); this row must NOT show up under bulkActionDetails.
    fixtures.reportExportAuditLog.push({
      id: 1,
      reportKind: "admin.qbMapping.cleanupAudit",
      format: "csv",
      scope: { bulkActionId: 42 },
      downloadedByUserId: 7,
      userRole: "admin",
      createdAt: new Date("2026-04-01T10:00:00Z"),
    });

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/42/downloads")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.downloadCount).toBe(0);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/abc/downloads")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation.invalid_id");
  });

  it("requires admin", async () => {
    const cookie = buildTestCookie({
      userId: 50,
      role: "vendor",
      displayName: "Vendor",
    });
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/42/downloads")
      .set("Cookie", cookie);
    expect([401, 403]).toContain(res.status);
  });
});
