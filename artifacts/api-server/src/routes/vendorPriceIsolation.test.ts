import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mock = vi.hoisted(() => ({ partnerIds: [21] as number[] | null, owned: [{ id: 101 }] as { id: number }[],
  updated: [{ workTypeId: 101 }] as { workTypeId: number }[], update: vi.fn(), set: vi.fn(), condition: vi.fn() }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const select = { from: () => select, where: () => select, limit: async () => mock.owned };
  const update = { set: (data: unknown) => { mock.set(data); return update; },
    where: (condition: unknown) => { mock.condition(condition); return update; }, returning: async () => mock.updated };
  mock.update.mockImplementation(() => update);
  return { ...original, db: { select: () => select, update: mock.update } };
});
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => ({ role: "admin", userId: 1 }) }));
vi.mock("../lib/partner-catalog-access", () => ({ vendorCatalogPartnerIds: async () => mock.partnerIds, catalogSaveScope: vi.fn() }));
import router from "./vendorWorkTypesSelfService";

const app = express();
app.use(express.json(), router);
const payload = { partnerId: 21, unitPrice: "125.50", unit: "per_hour", currency: "USD", notes: "Agreed rate" };
describe("single partner price updates", () => {
  beforeEach(() => {
    mock.partnerIds = [21]; mock.owned = [{ id: 101 }]; mock.updated = [{ workTypeId: 101 }];
    mock.update.mockClear(); mock.set.mockClear(); mock.condition.mockClear();
  });
  it("updates only the target vendor/work-type row, ignoring stale sibling payloads", async () => {
    const result = await request(app).put("/vendors/10/work-types/101/price")
      .send({ ...payload, items: [{ workTypeId: 202, unitPrice: "1" }] });
    expect(result.status).toBe(200);
    expect(mock.update).toHaveBeenCalledTimes(1);
    expect(mock.set.mock.calls[0][0]).toMatchObject({ unitPrice: "125.50", currency: "USD" });
    const query = new PgDialect().sqlToQuery(mock.condition.mock.calls[0][0]);
    expect(query.params).toEqual([10, 101]);
    expect(query.params).not.toContain(202);
  });
  it("rejects a partner outside approved relationships without writing", async () => {
    const result = await request(app).put("/vendors/10/work-types/101/price").send({ ...payload, partnerId: 22 });
    expect(result.status).toBe(403);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("rejects a work type owned by a different partner without writing", async () => {
    mock.owned = [];
    expect((await request(app).put("/vendors/10/work-types/202/price").send(payload)).status).toBe(403);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("rejects missing partner scope and invalid prices", async () => {
    expect((await request(app).put("/vendors/10/work-types/101/price").send({ ...payload, partnerId: undefined })).status).toBe(400);
    expect((await request(app).put("/vendors/10/work-types/101/price").send({ ...payload, unitPrice: "-1" })).status).toBe(400);
    expect(mock.update).not.toHaveBeenCalled();
  });
});
