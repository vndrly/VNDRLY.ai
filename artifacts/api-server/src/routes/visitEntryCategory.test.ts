import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildTestCookie } from "../test-utils/session";
const state = vi.hoisted(() => ({ updates: [] as unknown[], filters: [] as unknown[], rows: [{ id: 1, entryCategory: "partner_admin" }] as unknown[] }));
vi.mock("@workspace/db", async () => ({ ...(await import("@workspace/db/schema")), db: {
  update: () => ({ set: (value: unknown) => { state.updates.push(value); return { where: (filter: unknown) => { state.filters.push(filter); return { returning: async () => state.rows }; } }; } }),
  select: () => { throw new Error("Unexpected database read"); },
} }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {} }));
vi.mock("./notifications", () => ({ notifyUsers: vi.fn(), findPartnerUserIds: vi.fn(), findVendorUserIds: vi.fn(), findPartnerVisitNotifierUserIds: vi.fn(), findVendorVisitNotifierUserIds: vi.fn() }));
import categoryRouter, { visitEntryCategoryScope } from "./visitEntryCategory";
import visitsRouter from "./visits";
import { parseVisitEntryCategory } from "../lib/visit-entry-category";
const app = express().use(cookieParser()).use(express.json()).use("/api", categoryRouter, visitsRouter);
const cookie = (role: string, partnerId: number | null = null, vendorId: number | null = null, vendorRole?: string) => buildTestCookie({ userId: 1, role, partnerId, vendorId, vendorRole });
beforeEach(() => { state.updates = []; state.filters = []; state.rows = [{ id: 1, entryCategory: "partner_admin" }]; });
describe("explicit staff visit categories", () => {
  it.each(["visitor", "routine_vendor_work", "partner_admin", "vendor_admin"])("accepts only defined category %s", category => expect(parseVisitEntryCategory(category)).toBe(category));
  it("preserves legacy unknown category without inferring role", () => {
    expect(parseVisitEntryCategory(null)).toBeNull();
    expect(() => parseVisitEntryCategory("CEO delivering equipment")).toThrow();
  });
  it.each(["partner_admin", "vendor_admin", "visitor"])("guest check-in cannot assert category %s", async entryCategory => {
    const response = await request(app).post("/api/visits/check-in").send({ entryCategory });
    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });
  it("rejects an unknown category at authenticated gate check-in before any insert", async () => {
    const response = await request(app).post("/api/visits/gate/check-in").set("Cookie", cookie("vendor", null, 7, "gatekeeper")).send({ entryCategory: "owner" });
    expect(response.status).toBe(400);
    expect(state.updates).toEqual([]);
  });
  it("lets partner staff record a category only with owning-site scope in the mutation", async () => {
    const response = await request(app).patch("/api/visits/1/entry-category").set("Cookie", cookie("partner", 2)).send({ entryCategory: "partner_admin" });
    expect(response.status).toBe(200);
    expect(response.body.entryCategory).toBe("partner_admin");
    expect(state.updates).toEqual([{ entryCategory: "partner_admin" }]);
    const filter = new PgDialect().sqlToQuery(state.filters[0] as any);
    expect(filter.sql).toContain("s.partner_id =");
    expect(filter.params).toEqual([1, 2]);
  });
  it("limits vendor office edits to their hosted visitor records", () => {
    const filter = new PgDialect().sqlToQuery(visitEntryCategoryScope({ userId: 1, role: "vendor", vendorId: 7 })!);
    expect(filter.params).toEqual(["vendor", 7]);
  });
  it("limits gate edits to assigned sites", () => {
    const filter = new PgDialect().sqlToQuery(visitEntryCategoryScope({ userId: 1, role: "vendor", vendorId: 7, vendorRole: "gatekeeper" })!);
    expect(filter.sql).toContain("a.site_location_id =");
    expect(filter.params).toEqual([7]);
  });
  it("does not update an inaccessible visit", async () => {
    state.rows = [];
    const response = await request(app).patch("/api/visits/999/entry-category").set("Cookie", cookie("partner", 2)).send({ entryCategory: "visitor" });
    expect(response.status).toBe(404);
  });
  it.each(["guest", "field_employee"])("rejects category editing by %s", async role => {
    const response = await request(app).patch("/api/visits/1/entry-category").set("Cookie", cookie(role, null, 7)).send({ entryCategory: "vendor_admin" });
    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });
  it("denies a field employee arbitrary visit detail before querying private data", async () => {
    const response = await request(app).get("/api/visits/123").set("Cookie", cookie("field_employee", null, 7));
    expect(response.status).toBe(403);
  });
});
