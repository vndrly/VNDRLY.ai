import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";

const state = vi.hoisted(() => ({ data: {} as Record<string, any[]>, classified: vi.fn() }));
vi.mock("../services/service-matching/catalog-classification", () => ({ classifySavedWorkType: state.classified }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<any>();
  const db: any = {
    select: () => {
      let table: string;
      const q: any = { from: (value: any) => { table = getTableName(value); return q; }, where: () => q, orderBy: () => q, limit: () => q,
        then: (resolve: any, reject: any) => Promise.resolve(state.data[table] ?? []).then(resolve, reject) };
      return q;
    },
    insert: (table: any) => ({ values: (value: any) => {
      const name = getTableName(table);
      const row = { id: 21, ...value };
      if (name === "work_types") state.data[name] = [row];
      return { returning: async () => [row], onConflictDoUpdate: async () => undefined };
    } }),
    update: (table: any) => ({ set: (value: any) => ({ where: () => {
      const name = getTableName(table);
      state.data[name] = state.data[name].map(row => ({ ...row, ...value }));
      const result: any = { returning: async () => state.data[name], then: (resolve: any) => Promise.resolve().then(resolve) };
      return result;
    } }) }),
    delete: () => ({ where: async () => undefined }),
    transaction: async (run: any) => run(db),
  };
  return { ...original, db };
});
import partnerRouter from "./partnerWorkTypeAfes";
import workTypeRouter from "./workTypes";

const app = express().use(cookieParser()).use(express.json()).use("/api", partnerRouter).use("/api", workTypeRouter);
attachTestErrorMiddleware(app);
const cookie = buildTestCookie({ userId: 1, role: "admin" });
beforeEach(() => {
  state.classified.mockReset();
  state.classified.mockImplementation(async (id: number) => {
    // Hooks must run after the authoritative row is saved, not on request text.
    expect(state.data.work_types.find(row => row.id === id)).toBeDefined();
    return "pending";
  });
  state.data = { partners: [{ id: 9 }], work_types: [{ id: 21, partnerId: 9, name: "Gatekeeping", category: "Security", description: "Original" }], partner_work_type_afes: [], vendors: [] };
});

describe("catalog mutation classification wiring", () => {
  it.each(["/partners/9/work-types", "/work-types"])("classifies the committed create at %s even when provider remains pending", async path => {
    const result = await request(app).post(`/api${path}`).set("Cookie", cookie).send({ name: "Gatekeeping", category: "Security", description: "Saved description" });
    expectStatus(result, 201);
    expect(state.classified).toHaveBeenCalledWith(21);
    expect(state.data.work_types[0].description).toBe("Saved description");
    expect(state.data.work_types[0].partnerId).toBe(path.startsWith("/partners") ? 9 : null);
  });
  it.each(["/partners/9/work-types/21", "/work-types/21"])("classifies the committed edit at %s", async path => {
    const result = await request(app).put(`/api${path}`).set("Cookie", cookie).send({ description: "New operational scope" });
    expectStatus(result, 200);
    expect(state.classified).toHaveBeenCalledWith(21);
    expect(state.data.work_types[0].description).toBe("New operational scope");
  });
  it("repairs classification for matched partner AFE imports without minting or rescoping catalog rows", async () => {
    const result = await request(app).post("/api/partners/9/work-type-afes/import").set("Cookie", cookie).send({ rows: [{ name: "Gatekeeping", afe: "AFE-1" }, { name: "Unknown", afe: "AFE-2" }] });
    expectStatus(result, 200);
    expect(result.body).toMatchObject({ created: 1, unknown: ["Unknown"] });
    expect(state.classified).toHaveBeenCalledExactlyOnceWith(21);
    expect(state.data.work_types).toEqual([{ id: 21, partnerId: 9, name: "Gatekeeping", category: "Security", description: "Original" }]);
  });
  it("classifies each successful global catalog import through the same policy", async () => {
    const result = await request(app).post("/api/work-types/import").set("Cookie", cookie).send({ rows: [{ name: "Gatekeeping", category: "Security", description: "Imported scope" }] });
    expectStatus(result, 200);
    expect(result.body).toMatchObject({ updated: 1, errors: [] });
    expect(state.classified).toHaveBeenCalledExactlyOnceWith(21);
    expect(state.data.work_types[0].description).toBe("Imported scope");
  });
});
