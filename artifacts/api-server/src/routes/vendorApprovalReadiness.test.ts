import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ results: [] as unknown[][], insert: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const query = { from: () => query, where: () => query, limit: async () => mock.results.shift() ?? [] };
  return { ...original, db: { select: () => query, insert: mock.insert, update: mock.update, transaction: mock.transaction } };
});
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => ({ role: "admin", userId: 1 }) }));
import router from "./partnerVendorRelationships";

const app = express();
app.use(express.json(), router);
const incomplete = { federalTaxId: null, coiDocumentUrl: null, insuranceExpirationDate: null };
describe("approval routes retain compliance gates", () => {
  beforeEach(() => { mock.results = []; mock.insert.mockClear(); mock.update.mockClear(); mock.transaction.mockClear(); });
  it("does not create or accept a first agreement with missing compliance", async () => {
    mock.results = [[{ currentCatalogVersionId: null }], [incomplete]];
    const response = await request(app).post("/partners/21/vendor-relationships/10/accept-eula").send({ catalogVersionId: null });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("approvals.compliance_incomplete");
    expect(mock.transaction).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it("does not promote a relationship with missing compliance", async () => {
    mock.results = [[{ id: 1, status: "pending_review" }], [incomplete]];
    const response = await request(app).put("/partners/21/vendor-relationships/10").send({ status: "approved" });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("approvals.compliance_incomplete");
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("does not bypass missing compliance through bulk approval", async () => {
    mock.results = [[{ id: 1, status: "pending_review" }], [incomplete]];
    const response = await request(app).post("/partners/21/vendor-relationships/bulk-approve").send({ vendorIds: [10] });
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([{ vendorId: 10, ok: false, reason: "compliance_incomplete" }]);
    expect(mock.update).not.toHaveBeenCalled();
  });
});
