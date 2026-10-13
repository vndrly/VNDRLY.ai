import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ session: { userId: 1, vendorId: 7, activeMembershipId: 3 } as any, memberships: [{ role: "admin" }] as any[], execute: vi.fn() }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => state.session }));
vi.mock("@workspace/db", () => ({
  userOrgMembershipsTable: { userId: "userId", vendorId: "vendorId", orgType: "orgType", id: "id", role: "role" },
  db: { execute: state.execute, select: () => ({ from: () => ({ where: async () => state.memberships }) }) },
}));
import router from "./companyOperations";
const app = express().use(express.json()).use("/api", router);
beforeEach(() => { state.session = { userId: 1, vendorId: 7, activeMembershipId: 3 }; state.memberships = [{ role: "admin" }]; state.execute.mockReset().mockResolvedValue({ rows: [{ categories: ["fleet"] }] }); });
it("reads the active company's category for an employee without granting management", async () => {
  state.memberships = [{ role: "field_employee" }];
  const result = await request(app).get("/api/company-operations");
  expect(result.status).toBe(200); expect(result.body).toEqual({ vendorId: 7, categories: ["fleet"], canManage: false });
});
it("accepts exactly one category from the current company administrator", async () => {
  for (const category of ["field", "fleet", "gate"]) expect((await request(app).patch("/api/company-operations").send({ categories: [category] })).status).toBe(200);
});
it("rejects employee changes and forged company IDs", async () => {
  state.memberships = [{ role: "member" }];
  expect((await request(app).patch("/api/company-operations").send({ categories: ["gate"] })).status).toBe(403);
  state.memberships = [{ role: "admin" }];
  expect((await request(app).patch("/api/company-operations").send({ categories: ["fleet"], vendorId: 8 })).status).toBe(403);
  expect(state.execute).not.toHaveBeenCalled();
});
it("rejects missing membership, invalid values, and signed-out access", async () => {
  state.memberships = [];
  expect((await request(app).get("/api/company-operations")).status).toBe(403);
  expect((await request(app).patch("/api/company-operations").send({ categories: ["all"] })).status).toBe(400);
  state.session = null;
  expect((await request(app).get("/api/company-operations")).status).toBe(403);
});

it("saves multiple selected categories and rejects empty or duplicated selections", async () => {
 expect((await request(app).patch("/api/company-operations").send({categories:["field","gate"]})).body.categories).toEqual(["field","gate"]);
 expect((await request(app).patch("/api/company-operations").send({categories:[]})).status).toBe(400);
 expect((await request(app).patch("/api/company-operations").send({categories:["gate","gate"]})).status).toBe(400);
});

import { PgDialect } from "drizzle-orm/pg-core";
it("saves Fleet enablement atomically with categories and preserves existing Fleet records", async () => {
 const dialect = new PgDialect();
 for(const categories of [["fleet","gate"],["gate"]]) {
  state.execute.mockClear();
  expect((await request(app).patch("/api/company-operations").send({categories})).status).toBe(200);
  const query=dialect.sqlToQuery(state.execute.mock.calls[0][0]);
  expect(query.sql).toContain("fleet_ops_state = COALESCE(fleet_ops_state");
  expect(query.sql).toContain("jsonb_build_object");
  expect(query.params).toContain(categories.includes("fleet"));
  expect(query.params.at(-1)).toBe(7);
 }
});
