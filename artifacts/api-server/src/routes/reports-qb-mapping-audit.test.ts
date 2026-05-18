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
  nextId,
  resetMockDb,
} from "../test/mock-reports-db";

// Tests for the audit-row write that happens whenever an admin creates,
// updates, or deletes a QuickBooks account-mapping override via the
// PUT/DELETE /reports/qb-account-mapping handlers. The handlers under test
// upsert into qb_account_mapping and then call recordMappingAudit, which
// inserts into qb_account_mapping_audit_log capturing actor, scope, line
// type, and old/new values. These tests verify the audit row is written
// (and skipped on a no-op update) without touching a real database.
//
// The static `@workspace/db` exports (table tags + enum constants) are
// produced by `reportsDbModuleExports` (consumed transitively via
// `mock-reports-db`), so any new schema export added to reports.ts is
// picked up here automatically and never silently breaks this suite at
// module-load time.

// Spread the real `@workspace/db` exports first so any new schema export
// added to `routes/reports.ts` is automatically present on the mocked
// module — then layer the in-memory `db` and the explicit ColRef-backed
// table tags on top so the predicate evaluator can still reason about
// the tables this suite actually exercises. Without the spread, adding
// a new import to reports.ts would crash every test in this file at
// module-load time with "No 'X' export is defined on the @workspace/db
// mock"; with it, unknown tables fall through to the real Drizzle
// objects and the in-memory db just returns empty result sets for them.
vi.mock("@workspace/db", async () => {
  // Pull from the `/schema` subpath rather than the package root: the root
  // entry eagerly constructs a `pg.Pool` + `drizzle(pool, { schema })`,
  // which trips drizzle's relational-config extractor inside the test
  // environment. The schema subpath re-exports every table tag and enum
  // constant without that side effect, so spreading it is safe at mock-
  // factory time.
  const schema =
    await vi.importActual<typeof import("@workspace/db/schema")>(
      "@workspace/db/schema",
    );
  return { ...schema, ...(await makeReportsDbMock()) };
});
vi.mock("drizzle-orm", () => makeDrizzleMock());



function adminCookie(userId = 7): string {
  const payload = {
    userId,
    role: "admin",
    displayName: "Admin User",
  };
  return buildTestCookie(payload);
}

let app: express.Express;

beforeEach(async () => {
  resetMockDb({ qbAccountMapping: 1, qbAccountMappingAuditLog: 1 });
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

describe("PUT /api/reports/qb-account-mapping audit logging", () => {
  it("writes an 'insert' audit row when a brand-new override is created", async () => {
    const res = await request(app)
      .put("/api/reports/qb-account-mapping")
      .set("Cookie", adminCookie())
      .send({
        vendorId: 42,
        partnerId: null,
        lineType: "labor_regular",
        accountName: "Vendor 42 Labor",
        accountNumber: "4200",
      });
    expectStatus(res, 200);
    expect(res.body.override).toMatchObject({
      vendorId: 42,
      lineType: "labor_regular",
      accountName: "Vendor 42 Labor",
      accountNumber: "4200",
    });
    const audit = fixtures.qbAccountMappingAuditLog;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "insert",
      vendorId: 42,
      partnerId: null,
      lineType: "labor_regular",
      actorUserId: 7,
      actorRole: "admin",
      oldValues: null,
      newValues: { accountName: "Vendor 42 Labor", accountNumber: "4200" },
    });
    expect(audit[0].mappingId).toBe(res.body.override.id);
  });

  it("writes an 'update' audit row capturing old vs new values when an existing override is changed", async () => {
    fixtures.qbAccountMapping.push({
      id: 100,
      vendorId: 42,
      partnerId: null,
      lineType: "labor_regular",
      accountName: "Old Name",
      accountNumber: "1000",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    nextId.qbAccountMapping = 101;

    const res = await request(app)
      .put("/api/reports/qb-account-mapping")
      .set("Cookie", adminCookie())
      .send({
        vendorId: 42,
        partnerId: null,
        lineType: "labor_regular",
        accountName: "New Name",
        accountNumber: "2000",
      });
    expectStatus(res, 200);
    expect(fixtures.qbAccountMapping[0]).toMatchObject({
      accountName: "New Name",
      accountNumber: "2000",
    });

    const audit = fixtures.qbAccountMappingAuditLog;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "update",
      mappingId: 100,
      vendorId: 42,
      partnerId: null,
      lineType: "labor_regular",
      oldValues: { accountName: "Old Name", accountNumber: "1000" },
      newValues: { accountName: "New Name", accountNumber: "2000" },
      actorUserId: 7,
      actorRole: "admin",
    });
  });

  it("does NOT write an audit row when the upsert is a no-op (same values)", async () => {
    fixtures.qbAccountMapping.push({
      id: 200,
      vendorId: null,
      partnerId: null,
      lineType: "materials",
      accountName: "Materials Income",
      accountNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    nextId.qbAccountMapping = 201;

    const res = await request(app)
      .put("/api/reports/qb-account-mapping")
      .set("Cookie", adminCookie())
      .send({
        vendorId: null,
        partnerId: null,
        lineType: "materials",
        accountName: "Materials Income",
        accountNumber: null,
      });
    expectStatus(res, 200);
    expect(fixtures.qbAccountMappingAuditLog).toHaveLength(0);
  });

  it("rejects non-admins (no audit row written)", async () => {
    const cookie = buildTestCookie({ userId: 9, role: "vendor", vendorId: 1 });
    const res = await request(app)
      .put("/api/reports/qb-account-mapping")
      .set("Cookie", cookie)
      .send({
        vendorId: 1,
        lineType: "labor_regular",
        accountName: "Hax",
      });
    expect(res.status).toBe(403);
    expect(fixtures.qbAccountMappingAuditLog).toHaveLength(0);
    expect(fixtures.qbAccountMapping).toHaveLength(0);
  });
});

describe("DELETE /api/reports/qb-account-mapping/:id audit logging", () => {
  it("writes a 'delete' audit row containing the removed override's old values", async () => {
    fixtures.qbAccountMapping.push({
      id: 300,
      vendorId: 5,
      partnerId: 9,
      lineType: "equipment",
      accountName: "Specialised Equipment",
      accountNumber: "5500",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    nextId.qbAccountMapping = 301;

    const res = await request(app)
      .delete("/api/reports/qb-account-mapping/300")
      .set("Cookie", adminCookie(11));
    expectStatus(res, 200);
    expect(res.body).toEqual({ ok: true });
    expect(fixtures.qbAccountMapping).toHaveLength(0);

    const audit = fixtures.qbAccountMappingAuditLog;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "delete",
      mappingId: 300,
      vendorId: 5,
      partnerId: 9,
      lineType: "equipment",
      oldValues: {
        accountName: "Specialised Equipment",
        accountNumber: "5500",
      },
      newValues: null,
      actorUserId: 11,
      actorRole: "admin",
    });
  });

  it("returns 404 and writes no audit row when the override id does not exist", async () => {
    const res = await request(app)
      .delete("/api/reports/qb-account-mapping/999")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(404);
    expect(fixtures.qbAccountMappingAuditLog).toHaveLength(0);
  });

  it("rejects non-admins", async () => {
    fixtures.qbAccountMapping.push({
      id: 400,
      vendorId: null,
      partnerId: null,
      lineType: "tax_payable",
      accountName: "Sales Tax Payable",
      accountNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const cookie = buildTestCookie({ userId: 9, role: "partner", partnerId: 1 });
    const res = await request(app)
      .delete("/api/reports/qb-account-mapping/400")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(fixtures.qbAccountMapping).toHaveLength(1); // not deleted
    expect(fixtures.qbAccountMappingAuditLog).toHaveLength(0);
  });
});

describe("GET /api/reports/qb-account-mapping/audit filters & paging", () => {
  // Seed a mix of audit rows that exercise every filter axis so each
  // assertion below can target a single one without leaking matches from
  // unrelated rows.
  function seed(): void {
    const base = +new Date("2026-04-01T00:00:00Z");
    const rows: Array<{
      id: number;
      lineType: string;
      vendorId: number | null;
      partnerId: number | null;
      actorUserId: number | null;
      actorRole: string;
      action: string;
      oldValues: Record<string, unknown> | null;
      newValues: Record<string, unknown> | null;
      mappingId: number | null;
      createdAt: Date;
    }> = [];
    for (let i = 0; i < 60; i++) {
      rows.push({
        id: i + 1,
        lineType: i % 2 === 0 ? "labor_regular" : "materials",
        vendorId: i % 3 === 0 ? 11 : null,
        partnerId: i % 5 === 0 ? 22 : null,
        actorUserId: i % 4 === 0 ? 7 : 8,
        actorRole: "admin",
        action: "update",
        oldValues: { accountName: "old" },
        newValues: { accountName: "new" },
        mappingId: 1000 + i,
        // Spread rows across ~60 days so the date-range filter has something
        // to bite on.
        createdAt: new Date(base + i * 86_400_000),
      });
    }
    fixtures.qbAccountMappingAuditLog.push(...rows);
    nextId.qbAccountMappingAuditLog = 1000;
  }

  it("returns the first page with total + hasMore + actor facets", async () => {
    seed();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/audit?limit=20&offset=0")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(20);
    expect(res.body.total).toBe(60);
    expect(res.body.hasMore).toBe(true);
    // Facet should dedupe the two actor ids we seeded.
    const facetIds = (
      res.body.facets.actors as Array<{ id: number }>
    ).map((a) => a.id).sort();
    expect(facetIds).toEqual([7, 8]);
  });

  it("paginates via offset and reports hasMore=false on the last page", async () => {
    seed();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/audit?limit=20&offset=40")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows).toHaveLength(20);
    expect(res.body.total).toBe(60);
    expect(res.body.hasMore).toBe(false);
  });

  it("filters by lineType server-side", async () => {
    seed();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/audit?lineType=materials&limit=200")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.total).toBe(30);
    for (const r of res.body.rows) expect(r.lineType).toBe("materials");
  });

  it("filters by vendor scope (vendorId IS NOT NULL, partnerId IS NULL)", async () => {
    seed();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/audit?scope=vendor&limit=200")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    for (const r of res.body.rows) {
      expect(r.vendorId).not.toBeNull();
      expect(r.partnerId).toBeNull();
    }
  });

  it("filters by global scope (both ids NULL)", async () => {
    seed();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/audit?scope=global&limit=200")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    for (const r of res.body.rows) {
      expect(r.vendorId).toBeNull();
      expect(r.partnerId).toBeNull();
    }
  });

  it("filters by actorUserId", async () => {
    seed();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/audit?actorUserId=7&limit=200")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    for (const r of res.body.rows) expect(r.actorUserId).toBe(7);
  });

  it("rejects malformed filter input with 400", async () => {
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/audit?vendorId=not-a-number")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation.invalid_input");
  });

  it("rejects non-admins", async () => {
    const cookie = buildTestCookie({ userId: 9, role: "partner", partnerId: 1 });
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/audit")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
  });
});
