import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
const state = vi.hoisted(() => ({ session: { userId: 9, role: "vendor", vendorId: 12 } as Record<string, unknown>, allowed: true, select: vi.fn(), where: undefined as unknown, fields: undefined as unknown }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => state.session }));
vi.mock("../lib/vendor-people-management", () => ({ assertCanManageVendorPeople: () => state.allowed ? { ok: true } : { ok: false, status: 403 } }));
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: { select: (fields: unknown) => { state.select(); state.fields = fields; return { from: () => ({ leftJoin: () => ({ where: (where: unknown) => { state.where = where; return { orderBy: () => ({ limit: async () => [] }) }; } }) }) }; } } };
});
import router from "./implementationAWorkforce";
const app = express(); app.use(router);
const path = "/implementation-a/workforce/ticket-assignment-candidates";
describe("crew selection roster", () => {
  beforeEach(() => { vi.clearAllMocks(); state.session = { userId: 9, role: "vendor", vendorId: 12 }; state.allowed = true; });
  it("denies foreign selection and canonical permission failure before reading people", async () => {
    expect((await request(app).get(`${path}?vendorId=99`)).status).toBe(403);
    state.allowed = false;
    expect((await request(app).get(path)).status).toBe(403);
    expect(state.select).not.toHaveBeenCalled();
  });
  it("requires platform admins to name an exact vendor", async () => {
    state.session = { userId: 1, role: "admin" };
    expect((await request(app).get(path)).status).toBe(403);
    expect(state.select).not.toHaveBeenCalled();
    expect((await request(app).get(`${path}?vendorId=12`)).status).toBe(200);
  });
  it("projects only selection fields and filters inactive, deleted, suspended and non-field people", async () => {
    const response = await request(app).get(`${path}?name=Bob`);
    expect(response.status).toBe(200);
    expect(response.body.assignmentEligibilityVerified).toBe(false);
    expect(Object.keys(state.fields as object)).toEqual(["crewEmployeeId", "userId", "vendorId", "firstName", "lastName", "vendorRole"]);
    const query = new PgDialect().sqlToQuery(state.where as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(query.params).toEqual(expect.arrayContaining([12, true, "field", "both", "foreman", "%Bob%"]));
    for (const column of ["vendor_id", "is_active", "deleted_at", "suspended_at", "vendor_role"]) expect(query.sql).toContain(column);
  });
});
