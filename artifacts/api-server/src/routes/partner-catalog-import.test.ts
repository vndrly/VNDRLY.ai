import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";
const state = vi.hoisted(() => ({ role: "admin", current: true, run: vi.fn() }));
vi.mock("../services/marketplace/partner-store", () => ({ createPostgresPartnerMarketplaceStore: () => ({ authorize: async () => state.current }) }));
vi.mock("../services/marketplace/partner-catalog-import", async original => ({ ...await original<Record<string, unknown>>(), importPartnerCatalog: state.run }));
vi.mock("@workspace/db", async original => {
  const actual = await original<Record<string, unknown>>();
  return { ...actual, db: { select: () => {
    let table: string;
    const query: any = { from(value: any) { table = getTableName(value); return query; }, where() { return query; }, limit() { return query; },
      then(resolve: any, reject: any) { return Promise.resolve(table === "partners" ? [{ id: 9 }] : [{ role: state.role }]).then(resolve, reject); } };
    return query;
  } } };
});
import router from "./partnerWorkTypeAfes";
const app = express().use(cookieParser()).use(express.json()).use("/api", router);
const cookie = buildTestCookie({ userId: 7, role: "partner", partnerId: 9, activeMembershipId: 4 });
const body = { fileName: "original.csv", sourceBase64: Buffer.from("name\nGatekeeping\n").toString("base64"), mode: "preview" };
beforeEach(() => { state.role = "admin"; state.current = true; state.run.mockReset().mockResolvedValue({ rows: [], created: 0 }); });
it("passes only authorized partner ownership and original source to the importer", async () => {
  const response = await request(app).post("/api/partners/9/catalog-import").set("Cookie", cookie).send(body);
  expect(response.status).toBe(200);
  expect(state.run).toHaveBeenCalledWith(9, 7, "partner", body);
});
it("rejects another partner, ordinary member and revoked current authority before import", async () => {
  expect((await request(app).post("/api/partners/10/catalog-import").set("Cookie", cookie).send(body)).status).toBe(403);
  state.role = "member";
  expect((await request(app).post("/api/partners/9/catalog-import").set("Cookie", cookie).send(body)).status).toBe(403);
  state.role = "admin"; state.current = false;
  expect((await request(app).post("/api/partners/9/catalog-import").set("Cookie", cookie).send(body)).status).toBe(403);
  expect(state.run).not.toHaveBeenCalled();
});
it("protects preserved originals with the same current partner-admin authority", async () => {
  expect((await request(app).get("/api/partners/10/catalog-imports/1/source").set("Cookie", cookie)).status).toBe(403);
  state.current = false;
  expect((await request(app).get("/api/partners/9/catalog-imports/1/source").set("Cookie", cookie)).status).toBe(403);
});
