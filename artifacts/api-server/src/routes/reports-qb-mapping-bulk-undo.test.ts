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

// Tests for POST /reports/qb-account-mapping/bulk-actions/:id/undo. The
// handler reverts the snapshot recorded for one bulk-apply / CSV-import
// inside a single transaction: rows whose `previous` was null get
// stripped from `qb_account_mapping`, rows whose `previous` is set get
// upserted back to those values, and the bulk action itself is stamped
// `undoneAt` + `undoneByUserId`. A second undo against the same action
// must return 409 so the admin Undo button can surface "already
// undone"; an unknown id is 404; a malformed id is 400; and non-admins
// hit 403.

vi.mock("@workspace/db", () => makeReportsDbMock());
vi.mock("drizzle-orm", () => makeDrizzleMock());

function adminCookie(userId = 7): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin User",
  });
}

let app: express.Express;

beforeEach(async () => {
  resetMockDb({ qbAccountMapping: 1, qbAccountMappingBulkActions: 1 });
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

// Seed an action whose snapshot mixes both "this row was newly inserted
// by the bulk write" (previous: null → undo strips) and "this row was
// updated by the bulk write" (previous set → undo restores) cells. The
// matching `qb_account_mapping` rows are pre-seeded so the undo helper
// can find them by (vendorId, partnerId, lineType).
function seedActionWithMixedSnapshot(actionId = 50): void {
  // Cell A: bulk write inserted a brand-new row at (v=1, partner=null,
  // lineType=labor_regular). Undo should DELETE this row.
  fixtures.qbAccountMapping.push({
    id: 101,
    vendorId: 1,
    partnerId: null,
    lineType: "labor_regular",
    accountName: "Brand New Acct",
    accountNumber: "9999",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // Cell B: bulk write updated an existing row at (v=2, partner=10,
  // lineType=tax_payable). Undo should restore it to "Old Tax".
  fixtures.qbAccountMapping.push({
    id: 102,
    vendorId: 2,
    partnerId: 10,
    lineType: "tax_payable",
    accountName: "New Tax",
    accountNumber: "2200",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // Cell C: bulk write updated an existing row at (v=null, partner=null,
  // lineType=ar). Undo should restore it to "AR Old" with null number.
  fixtures.qbAccountMapping.push({
    id: 103,
    vendorId: null,
    partnerId: null,
    lineType: "ar",
    accountName: "AR New",
    accountNumber: "1200",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  fixtures.qbAccountMappingBulkActions.push({
    id: actionId,
    kind: "bulk_apply",
    summary: "mixed apply",
    snapshots: [
      {
        vendorId: 1,
        partnerId: null,
        lineType: "labor_regular",
        previous: null,
        applied: { accountName: "Brand New Acct", accountNumber: "9999" },
      },
      {
        vendorId: 2,
        partnerId: 10,
        lineType: "tax_payable",
        previous: { accountName: "Old Tax", accountNumber: "2100" },
        applied: { accountName: "New Tax", accountNumber: "2200" },
      },
      {
        vendorId: null,
        partnerId: null,
        lineType: "ar",
        previous: { accountName: "AR Old", accountNumber: null },
        applied: { accountName: "AR New", accountNumber: "1200" },
      },
    ],
    actorUserId: 100,
    actorRole: "admin",
    createdAt: new Date(),
    undoneAt: null,
    undoneByUserId: null,
  });
}

describe("POST /api/reports/qb-account-mapping/bulk-actions/:id/undo", () => {
  it("restores updated rows, removes inserted rows, and stamps undoneAt + undoneByUserId", async () => {
    seedActionWithMixedSnapshot(50);

    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/50/undo")
      .set("Cookie", adminCookie(7));

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      ok: true,
      restored: 2,
      removed: 1,
    });

    // The newly-inserted cell A row must be gone.
    const remaining = fixtures.qbAccountMapping.find((r) => r.id === 101);
    expect(remaining).toBeUndefined();

    // Cell B updated back to its previous values.
    const cellB = fixtures.qbAccountMapping.find((r) => r.id === 102);
    expect(cellB).toMatchObject({
      accountName: "Old Tax",
      accountNumber: "2100",
    });

    // Cell C updated back to its previous values, including null number.
    const cellC = fixtures.qbAccountMapping.find((r) => r.id === 103);
    expect(cellC).toMatchObject({
      accountName: "AR Old",
      accountNumber: null,
    });

    // The action row itself must be stamped with the actor and a real
    // undoneAt timestamp so the GET endpoint can render "undone by ...".
    const action = fixtures.qbAccountMappingBulkActions.find(
      (r) => r.id === 50,
    );
    expect(action).toBeDefined();
    expect(action!.undoneByUserId).toBe(7);
    expect(action!.undoneAt).toBeInstanceOf(Date);
  });

  it("returns 409 the second time undo is called against the same action", async () => {
    seedActionWithMixedSnapshot(51);

    const first = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/51/undo")
      .set("Cookie", adminCookie(7));
    expectStatus(first, 200);

    const second = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/51/undo")
      .set("Cookie", adminCookie(7));
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      code: "report.bulk_action_already_undone",
    });
  });

  it("returns 404 for an unknown action id", async () => {
    // No seed — fixtures.qbAccountMappingBulkActions is empty.
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/99999/undo")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: "report.bulk_action_not_found",
    });
  });

  it("returns 400 for a malformed (non-numeric) id", async () => {
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/not-a-number/undo")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "validation.invalid_id",
    });
  });

  it("returns 400 for a non-positive id", async () => {
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/0/undo")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "validation.invalid_id",
    });
  });

  it("rejects non-admins with 403 and never touches the action row", async () => {
    seedActionWithMixedSnapshot(52);

    const cookie = buildTestCookie({
      userId: 9,
      role: "vendor",
      vendorId: 1,
    });
    const res = await request(app)
      .post("/api/reports/qb-account-mapping/bulk-actions/52/undo")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);

    // The action must still be in its pre-undo state — no stamping, no
    // snapshot mutation.
    const action = fixtures.qbAccountMappingBulkActions.find(
      (r) => r.id === 52,
    );
    expect(action).toBeDefined();
    expect(action!.undoneAt).toBeNull();
    expect(action!.undoneByUserId).toBeNull();
    // The seeded mapping rows must be untouched.
    expect(
      fixtures.qbAccountMapping.find((r) => r.id === 101),
    ).toBeDefined();
    expect(
      fixtures.qbAccountMapping.find((r) => r.id === 102)?.accountName,
    ).toBe("New Tax");
  });
});
