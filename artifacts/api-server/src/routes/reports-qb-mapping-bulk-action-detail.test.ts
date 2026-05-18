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

// Tests for GET /reports/qb-account-mapping/bulk-actions/:id, the
// drill-in endpoint that returns the full per-cell snapshot for one
// bulk-apply or CSV-import action with vendor and partner names
// resolved. Covers slicing (offset/limit), name resolution, and the
// 404 / 400 paths.

type Row = Record<string, any>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "inArray"; col: ColRef; vals: any[] }
  | { kind: "and"; preds: Pred[] }
  | { kind: "true" };

// Column lists for every table referenced by reports.ts come from the
// real Drizzle schema via `makeReportsDbTables` — adding or renaming a
// column doesn't require touching this test. Top-level await is safe
// here because the test file is ESM (api-server `package.json` has
// `"type": "module"`); vitest hoists the `vi.mock` calls below before
// this import-phase await runs, so the schema load proceeds with the
// mocked `drizzle-orm` already registered.
const tables = await makeReportsDbTables();

const fixtures: Record<string, Row[]> = {
  qbAccountMappingBulkActions: [],
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
      // Mimic left-joined user columns the route selects from usersTable.
      if (joinedTables.includes("users")) {
        const actor = (fixtures.users ?? []).find(
          (u) => u.id === r.actorUserId,
        );
        out.actorDisplayName = actor?.displayName ?? null;
        out.actorUsername = actor?.username ?? null;
      }
      return out;
    });
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
  const sqlTag: any = (..._args: any[]) => ({ kind: "true" });
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

describe("GET /api/reports/qb-account-mapping/bulk-actions/:id", () => {
  it("returns the full snapshot with vendor/partner names resolved", async () => {
    fixtures.users.push({
      id: 7,
      displayName: "Alice Admin",
      username: "alice",
    });
    fixtures.vendors.push({ id: 100, name: "Acme Co" });
    fixtures.vendors.push({ id: 101, name: "Beta Inc" });
    fixtures.partners.push({ id: 200, name: "Partner X" });
    fixtures.qbAccountMappingBulkActions.push({
      id: 1,
      kind: "csv_import",
      summary: "qb-mapping.csv (3 rows)",
      snapshots: [
        {
          vendorId: 100,
          partnerId: 200,
          lineType: "labor_regular",
          previous: { accountName: "Old Labor", accountNumber: "1000" },
          applied: { accountName: "New Labor", accountNumber: "1100" },
        },
        {
          vendorId: 101,
          partnerId: null,
          lineType: "tax_payable",
          previous: null,
          applied: { accountName: "Tax Payable", accountNumber: "2200" },
        },
        {
          vendorId: null,
          partnerId: null,
          lineType: "ar",
          previous: { accountName: "AR Old", accountNumber: null },
          applied: { accountName: "AR New", accountNumber: "1200" },
        },
      ],
      actorUserId: 7,
      actorRole: "admin",
      createdAt: new Date("2026-04-01T10:00:00Z"),
      undoneAt: null,
      undoneByUserId: null,
    });

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/1")
      .set("Cookie", adminCookie());

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      id: 1,
      kind: "csv_import",
      summary: "qb-mapping.csv (3 rows)",
      actorUserId: 7,
      actorRole: "admin",
      actorDisplayName: "Alice Admin",
      actorUsername: "alice",
      snapshotCount: 3,
      offset: 0,
      limit: 200,
    });
    expect(res.body.cells).toHaveLength(3);
    expect(res.body.cells[0]).toMatchObject({
      vendorId: 100,
      vendorName: "Acme Co",
      partnerId: 200,
      partnerName: "Partner X",
      lineType: "labor_regular",
      previous: { accountName: "Old Labor", accountNumber: "1000" },
      applied: { accountName: "New Labor", accountNumber: "1100" },
    });
    expect(res.body.cells[1]).toMatchObject({
      vendorId: 101,
      vendorName: "Beta Inc",
      partnerId: null,
      partnerName: null,
      lineType: "tax_payable",
      previous: null,
      applied: { accountName: "Tax Payable", accountNumber: "2200" },
    });
    expect(res.body.cells[2]).toMatchObject({
      vendorId: null,
      vendorName: null,
      partnerId: null,
      partnerName: null,
      lineType: "ar",
    });
  });

  it("paginates with offset and limit and clamps limit to 500", async () => {
    const snapshots = Array.from({ length: 600 }, (_, i) => ({
      vendorId: null,
      partnerId: null,
      lineType: `line_${i}`,
      previous: null,
      applied: { accountName: `Acct ${i}`, accountNumber: null },
    }));
    fixtures.qbAccountMappingBulkActions.push({
      id: 5,
      kind: "csv_import",
      summary: "big.csv",
      snapshots,
      actorUserId: null,
      actorRole: "admin",
      createdAt: new Date(),
      undoneAt: null,
      undoneByUserId: null,
    });

    const page1 = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/5?offset=0&limit=100")
      .set("Cookie", adminCookie());
    expectStatus(page1, 200);
    expect(page1.body.snapshotCount).toBe(600);
    expect(page1.body.offset).toBe(0);
    expect(page1.body.limit).toBe(100);
    expect(page1.body.cells).toHaveLength(100);
    expect(page1.body.cells[0].lineType).toBe("line_0");
    expect(page1.body.cells[99].lineType).toBe("line_99");

    const page2 = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/5?offset=500&limit=200",
      )
      .set("Cookie", adminCookie());
    expectStatus(page2, 200);
    expect(page2.body.cells).toHaveLength(100);
    expect(page2.body.cells[0].lineType).toBe("line_500");
    expect(page2.body.cells[99].lineType).toBe("line_599");

    const huge = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/5?limit=9999")
      .set("Cookie", adminCookie());
    expectStatus(huge, 200);
    // limit gets clamped to 500
    expect(huge.body.limit).toBe(500);
    expect(huge.body.cells).toHaveLength(500);
  });

  it("returns 404 for an unknown action id", async () => {
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/999")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("report.bulk_action_not_found");
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/abc")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation.invalid_id");
  });

  it("?format=csv returns the FULL snapshot as CSV with all-vendors / all-partners labels", async () => {
    fixtures.vendors.push({ id: 100, name: "Acme Co" });
    fixtures.partners.push({ id: 200, name: "Partner X" });
    fixtures.qbAccountMappingBulkActions.push({
      id: 1,
      kind: "csv_import",
      summary: "qb-mapping.csv (3 rows)",
      snapshots: [
        {
          vendorId: 100,
          partnerId: 200,
          lineType: "labor_regular",
          previous: { accountName: "Old Labor", accountNumber: "1000" },
          applied: { accountName: "New Labor", accountNumber: "1100" },
        },
        {
          // vendor scope of "all" must render explicitly so the CSV is
          // self-describing without the dialog around it.
          vendorId: null,
          partnerId: 200,
          lineType: "tax_payable",
          previous: null,
          applied: { accountName: "Tax Payable", accountNumber: "2200" },
        },
        {
          // both axes "all"; deleted/unknown vendor or partner ids would
          // fall back to "Vendor #N (deleted)" — covered separately by
          // the next test.
          vendorId: null,
          partnerId: null,
          lineType: "ar",
          previous: { accountName: "AR Old", accountNumber: null },
          applied: { accountName: "AR New", accountNumber: "1200" },
        },
      ],
      actorUserId: 7,
      actorRole: "admin",
      createdAt: new Date("2026-04-01T10:00:00Z"),
      undoneAt: null,
      undoneByUserId: null,
    });

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/1?format=csv")
      .set("Cookie", adminCookie());

    expectStatus(res, 200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment;\s*filename=/);
    expect(res.headers["content-disposition"]).toContain("qb-bulk-action");

    const lines = res.text.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe(
      "vendor,partner,line_type,previous_account_name,previous_account_number,applied_account_name,applied_account_number",
    );
    expect(lines).toHaveLength(4); // header + 3 cells
    expect(lines[1]).toBe("Acme Co,Partner X,labor_regular,Old Labor,1000,New Labor,1100");
    expect(lines[2]).toBe("All vendors,Partner X,tax_payable,,,Tax Payable,2200");
    expect(lines[3]).toBe("All vendors,All partners,ar,AR Old,,AR New,1200");
  });

  it("?format=csv ignores ?limit and exports every row", async () => {
    const snapshots = Array.from({ length: 750 }, (_, i) => ({
      vendorId: null,
      partnerId: null,
      lineType: `line_${i}`,
      previous: null,
      applied: { accountName: `Acct ${i}`, accountNumber: null },
    }));
    fixtures.qbAccountMappingBulkActions.push({
      id: 9,
      kind: "csv_import",
      summary: "huge.csv",
      snapshots,
      actorUserId: null,
      actorRole: "admin",
      createdAt: new Date(),
      undoneAt: null,
      undoneByUserId: null,
    });

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/9?format=csv&limit=100")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    const lines = res.text.split("\r\n").filter(Boolean);
    // header + 750 data rows — limit/offset must NOT clamp CSV output.
    expect(lines).toHaveLength(751);
  });

  it("?q= filters across vendor, partner, line type, and account fields, using the FULL snapshot", async () => {
    // Three rows split across two pages so we can prove the filter
    // runs over the FULL snapshot, not just the current page slice.
    fixtures.vendors.push({ id: 100, name: "Acme Co" });
    fixtures.vendors.push({ id: 101, name: "Beta Inc" });
    fixtures.partners.push({ id: 200, name: "Northwind Partner" });
    fixtures.qbAccountMappingBulkActions.push({
      id: 21,
      kind: "csv_import",
      summary: "qb-mapping.csv (3 rows)",
      snapshots: [
        {
          vendorId: 100,
          partnerId: 200,
          lineType: "labor_regular",
          previous: { accountName: "Old Labor", accountNumber: "1000" },
          applied: { accountName: "New Labor", accountNumber: "1100" },
        },
        {
          vendorId: 101,
          partnerId: null,
          lineType: "tax_payable",
          previous: null,
          applied: { accountName: "Sales Tax Payable", accountNumber: "2200" },
        },
        {
          vendorId: null,
          partnerId: null,
          lineType: "ar",
          previous: { accountName: "AR Old", accountNumber: null },
          applied: { accountName: "AR New", accountNumber: "1200" },
        },
      ],
      actorUserId: null,
      actorRole: "admin",
      createdAt: new Date("2026-04-01T10:00:00Z"),
      undoneAt: null,
      undoneByUserId: null,
    });

    // Match by vendor name (case-insensitive).
    const byVendor = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/21?q=acme")
      .set("Cookie", adminCookie());
    expectStatus(byVendor, 200);
    expect(byVendor.body.snapshotCount).toBe(1);
    expect(byVendor.body.cells).toHaveLength(1);
    expect(byVendor.body.cells[0]).toMatchObject({
      vendorId: 100,
      vendorName: "Acme Co",
      lineType: "labor_regular",
    });

    // Match by partner name.
    const byPartner = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/21?q=northwind")
      .set("Cookie", adminCookie());
    expectStatus(byPartner, 200);
    expect(byPartner.body.snapshotCount).toBe(1);
    expect(byPartner.body.cells[0].partnerName).toBe("Northwind Partner");

    // Match by line type.
    const byLineType = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/21?q=tax_payable")
      .set("Cookie", adminCookie());
    expectStatus(byLineType, 200);
    expect(byLineType.body.snapshotCount).toBe(1);
    expect(byLineType.body.cells[0].lineType).toBe("tax_payable");

    // Match by previous account name.
    const byPrevName = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/21?q=Old%20Labor")
      .set("Cookie", adminCookie());
    expectStatus(byPrevName, 200);
    expect(byPrevName.body.snapshotCount).toBe(1);
    expect(byPrevName.body.cells[0].previous).toMatchObject({
      accountName: "Old Labor",
    });

    // Match by previous account number.
    const byPrevNumber = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/21?q=1000")
      .set("Cookie", adminCookie());
    expectStatus(byPrevNumber, 200);
    expect(byPrevNumber.body.snapshotCount).toBe(1);
    expect(byPrevNumber.body.cells[0].previous).toMatchObject({
      accountNumber: "1000",
    });

    // Match by applied account name (and number 1100/1200/2200 — pick a
    // unique one) — also case-insensitive.
    const byAppliedName = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/21?q=SALES%20TAX")
      .set("Cookie", adminCookie());
    expectStatus(byAppliedName, 200);
    expect(byAppliedName.body.snapshotCount).toBe(1);
    expect(byAppliedName.body.cells[0].applied).toMatchObject({
      accountName: "Sales Tax Payable",
    });

    // No match → empty cells with snapshotCount 0 so the UI can render
    // its empty state.
    const noMatch = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/21?q=nonexistent")
      .set("Cookie", adminCookie());
    expectStatus(noMatch, 200);
    expect(noMatch.body.snapshotCount).toBe(0);
    expect(noMatch.body.cells).toHaveLength(0);

    // Empty / whitespace q is treated as no filter.
    const emptyQ = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/21?q=%20%20")
      .set("Cookie", adminCookie());
    expectStatus(emptyQ, 200);
    expect(emptyQ.body.snapshotCount).toBe(3);
    expect(emptyQ.body.cells).toHaveLength(3);
  });

  it("?q= filter runs across the full snapshot before pagination", async () => {
    // 600 cells where only 5 mention "needle"; with limit=100 they'd
    // never fit on one page if filtering ran client-side after
    // pagination. Server-side filtering should yield all 5 in one go.
    const snapshots = Array.from({ length: 600 }, (_, i) => ({
      vendorId: null,
      partnerId: null,
      lineType: i % 137 === 0 ? "needle_line" : `line_${i}`,
      previous: null,
      applied: { accountName: `Acct ${i}`, accountNumber: null },
    }));
    fixtures.qbAccountMappingBulkActions.push({
      id: 22,
      kind: "csv_import",
      summary: "haystack.csv",
      snapshots,
      actorUserId: null,
      actorRole: "admin",
      createdAt: new Date(),
      undoneAt: null,
      undoneByUserId: null,
    });

    const res = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/22?q=needle&offset=0&limit=100",
      )
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    // 600 / 137 = 5 cells (i = 0, 137, 274, 411, 548)
    expect(res.body.snapshotCount).toBe(5);
    expect(res.body.cells).toHaveLength(5);
    for (const c of res.body.cells) {
      expect(c.lineType).toBe("needle_line");
    }
  });

  it("?lineType=, ?vendorId=, and ?partnerId= scope-filter the snapshot before pagination/CSV", async () => {
    fixtures.vendors.push({ id: 100, name: "Acme Co" });
    fixtures.vendors.push({ id: 101, name: "Beta Inc" });
    fixtures.partners.push({ id: 200, name: "Northwind Partner" });
    fixtures.partners.push({ id: 201, name: "Southwind Partner" });
    fixtures.qbAccountMappingBulkActions.push({
      id: 33,
      kind: "csv_import",
      summary: "scoped.csv (4 rows)",
      snapshots: [
        {
          vendorId: 100,
          partnerId: 200,
          lineType: "labor_regular",
          previous: null,
          applied: { accountName: "Labor A", accountNumber: "1100" },
        },
        {
          vendorId: 100,
          partnerId: 201,
          lineType: "equipment",
          previous: null,
          applied: { accountName: "Eq A", accountNumber: "1200" },
        },
        {
          vendorId: 101,
          partnerId: 200,
          lineType: "labor_regular",
          previous: null,
          applied: { accountName: "Labor B", accountNumber: "1100" },
        },
        {
          // null-scope row matches via the "_all" sentinel.
          vendorId: null,
          partnerId: null,
          lineType: "labor_regular",
          previous: null,
          applied: { accountName: "Labor Global", accountNumber: "1100" },
        },
      ],
      actorUserId: null,
      actorRole: "admin",
      createdAt: new Date("2026-04-01T10:00:00Z"),
      undoneAt: null,
      undoneByUserId: null,
    });

    // lineType narrows to the three labor_regular rows (incl. the
    // null-scope one) — pagination total reflects the filter.
    const byLineType = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/33?lineType=labor_regular",
      )
      .set("Cookie", adminCookie());
    expectStatus(byLineType, 200);
    expect(byLineType.body.snapshotCount).toBe(3);
    expect(byLineType.body.cells).toHaveLength(3);
    for (const c of byLineType.body.cells) {
      expect(c.lineType).toBe("labor_regular");
    }

    // vendorId narrows to just vendor 100's two rows.
    const byVendor = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/33?vendorId=100")
      .set("Cookie", adminCookie());
    expectStatus(byVendor, 200);
    expect(byVendor.body.snapshotCount).toBe(2);
    for (const c of byVendor.body.cells) {
      expect(c.vendorId).toBe(100);
    }

    // partnerId narrows to partner 200's two rows.
    const byPartner = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/33?partnerId=200")
      .set("Cookie", adminCookie());
    expectStatus(byPartner, 200);
    expect(byPartner.body.snapshotCount).toBe(2);
    for (const c of byPartner.body.cells) {
      expect(c.partnerId).toBe(200);
    }

    // _all sentinel matches null-scope rows only.
    const byVendorAll = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/33?vendorId=_all")
      .set("Cookie", adminCookie());
    expectStatus(byVendorAll, 200);
    expect(byVendorAll.body.snapshotCount).toBe(1);
    expect(byVendorAll.body.cells[0].vendorId).toBeNull();

    // Filters compose: vendor 100 + line_type labor_regular = 1 row.
    const composed = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/33?vendorId=100&lineType=labor_regular",
      )
      .set("Cookie", adminCookie());
    expectStatus(composed, 200);
    expect(composed.body.snapshotCount).toBe(1);
    expect(composed.body.cells[0]).toMatchObject({
      vendorId: 100,
      partnerId: 200,
      lineType: "labor_regular",
    });

    // Filters apply to CSV too — without them we'd get 4 rows back.
    const csv = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/33?format=csv&lineType=labor_regular&vendorId=100",
      )
      .set("Cookie", adminCookie());
    expectStatus(csv, 200);
    const lines = csv.text.split("\r\n").filter(Boolean);
    // banner + header + 1 data row (scope filters mark the export as
    // filtered, same as ?q=).
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^# Filtered export — 1 of \d+ cell\(s\) shown$/);
    expect(lines[2]).toBe(
      "Acme Co,Northwind Partner,labor_regular,,,Labor A,1100",
    );
    expect(csv.headers["content-disposition"]).toContain(
      "qb-bulk-action-33-filtered.csv",
    );

    // Garbage filter values are ignored (no 400) — fall back to the
    // unfiltered snapshot of 4 rows.
    const garbage = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/33?vendorId=not-a-number&partnerId=-3",
      )
      .set("Cookie", adminCookie());
    expectStatus(garbage, 200);
    expect(garbage.body.snapshotCount).toBe(4);

    // Composes with ?q= as well — narrow to vendor 100, then search
    // "Eq" (only equipment row matches).
    const withQ = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/33?vendorId=100&q=Eq",
      )
      .set("Cookie", adminCookie());
    expectStatus(withQ, 200);
    expect(withQ.body.snapshotCount).toBe(1);
    expect(withQ.body.cells[0].lineType).toBe("equipment");

    // Critical: scope filter must constrain ?q= results too. "labor"
    // matches three rows by line type, but vendorId=101 is only in
    // ONE of them — the other two (vendor 100 and the null/global
    // row) must be excluded. Same expectation for the CSV export so
    // the in-app dialog and the downloaded file describe the same
    // subset.
    const scopeAndQ = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/33?vendorId=101&q=labor",
      )
      .set("Cookie", adminCookie());
    expectStatus(scopeAndQ, 200);
    expect(scopeAndQ.body.snapshotCount).toBe(1);
    expect(scopeAndQ.body.cells).toHaveLength(1);
    expect(scopeAndQ.body.cells[0]).toMatchObject({
      vendorId: 101,
      partnerId: 200,
      lineType: "labor_regular",
    });

    const scopeAndQCsv = await request(app)
      .get(
        "/api/reports/qb-account-mapping/bulk-actions/33?format=csv&vendorId=101&q=labor",
      )
      .set("Cookie", adminCookie());
    expectStatus(scopeAndQCsv, 200);
    // Filter is active, so the CSV is annotated with a leading
    // `# Filtered export` banner line and the filename gets a
    // `-filtered` suffix so a recipient receiving the file alone can
    // tell it isn't the full audit trail.
    expect(scopeAndQCsv.headers["content-disposition"]).toContain(
      "qb-bulk-action-33-filtered.csv",
    );
    const csvLines = scopeAndQCsv.text.split("\r\n").filter(Boolean);
    expect(csvLines).toHaveLength(3); // banner + header + 1 row
    expect(csvLines[0]).toMatch(
      /^# Filtered export — 1 of \d+ cell\(s\) shown$/,
    );
    expect(csvLines[2]).toBe(
      "Beta Inc,Northwind Partner,labor_regular,,,Labor B,1100",
    );
  });

  it("?format=csv with no filters keeps the unfiltered filename and omits the banner line", async () => {
    fixtures.vendors.push({ id: 410, name: "Acme Co" });
    fixtures.qbAccountMappingBulkActions.push({
      id: 41,
      kind: "csv_import",
      summary: "qb-mapping.csv (1 row)",
      snapshots: [
        {
          vendorId: 410,
          partnerId: null,
          lineType: "labor_regular",
          previous: null,
          applied: { accountName: "Labor", accountNumber: "1100" },
        },
      ],
      actorUserId: null,
      actorRole: "admin",
      createdAt: new Date(),
      undoneAt: null,
      undoneByUserId: null,
    });

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/41?format=csv")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.headers["content-disposition"]).toContain(
      "qb-bulk-action-41.csv",
    );
    expect(res.headers["content-disposition"]).not.toContain("filtered");
    expect(res.text.startsWith("vendor,partner,line_type,")).toBe(true);
    expect(res.text).not.toContain("# Filtered export");
  });

  it("?format=csv with ?q= alone marks the filename and prepends the banner line", async () => {
    fixtures.vendors.push({ id: 510, name: "Acme Co" });
    fixtures.vendors.push({ id: 511, name: "Beta Inc" });
    fixtures.qbAccountMappingBulkActions.push({
      id: 51,
      kind: "csv_import",
      summary: "qb-mapping.csv (2 rows)",
      snapshots: [
        {
          vendorId: 510,
          partnerId: null,
          lineType: "labor_regular",
          previous: null,
          applied: { accountName: "Labor", accountNumber: "1100" },
        },
        {
          vendorId: 511,
          partnerId: null,
          lineType: "labor_regular",
          previous: null,
          applied: { accountName: "Labor", accountNumber: "1100" },
        },
      ],
      actorUserId: null,
      actorRole: "admin",
      createdAt: new Date(),
      undoneAt: null,
      undoneByUserId: null,
    });

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/51?format=csv&q=acme")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.headers["content-disposition"]).toContain(
      "qb-bulk-action-51-filtered.csv",
    );
    const lines = res.text.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("# Filtered export — 1 of 2 cell(s) shown");
    expect(lines).toHaveLength(3); // banner + header + 1 matching row
    expect(lines[2]).toBe("Acme Co,All partners,labor_regular,,,Labor,1100");
  });

  it("?format=csv falls back to a deleted-vendor label when the lookup misses", async () => {
    // Vendor 999 referenced by the snapshot but missing from the
    // vendors fixture — simulates a vendor that was deleted after the
    // bulk action ran. The audit trail must still surface the id.
    fixtures.qbAccountMappingBulkActions.push({
      id: 11,
      kind: "bulk_apply",
      summary: "deleted vendor",
      snapshots: [
        {
          vendorId: 999,
          partnerId: null,
          lineType: "labor_regular",
          previous: null,
          applied: { accountName: "New Labor", accountNumber: "1100" },
        },
      ],
      actorUserId: null,
      actorRole: "admin",
      createdAt: new Date(),
      undoneAt: null,
      undoneByUserId: null,
    });

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions/11?format=csv")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    const lines = res.text.split("\r\n").filter(Boolean);
    expect(lines[1]).toBe(
      "Vendor #999 (deleted),All partners,labor_regular,,,New Labor,1100",
    );
  });
});
