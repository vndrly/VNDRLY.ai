import { beforeEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const state = vi.hoisted(() => ({ actor: null as any, office: true, execute: vi.fn(), txExecute: vi.fn() }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => state.actor }));
vi.mock("../lib/vendor-people-management", () => ({ isVendorOfficeStaff: async (actor: any, id: number) => state.office && (actor.role === "admin" || actor.vendorId === id) }));
vi.mock("@workspace/db", () => ({ db: { execute: state.execute, transaction: async (fn: any) => fn({ execute: state.txExecute }) } }));
import router from "./staffRoles";
const app = express().use(express.json()).use("/api", router);
const payroll = { id: "common:Payroll", label: "Payroll", group: "Accounting" };
beforeEach(() => { vi.clearAllMocks(); state.actor = { userId: 1, role: "vendor", vendorId: 7 }; state.office = true; state.execute.mockResolvedValue({ rows: [{ staff_role_catalog: null }] }); state.txExecute.mockResolvedValue({ rows: [{ staff_role_catalog: null }] }); });
it("limits edits to company office/admin and allows own-company staff to read", async () => {
  state.actor = null; expect((await request(app).get("/api/vendors/7/staff-roles")).status).toBe(401);
  state.actor = { userId: 1, role: "vendor", vendorId: 8 }; expect((await request(app).get("/api/vendors/7/staff-roles")).status).toBe(403);
  state.actor.vendorId = 7; state.office = false;
  expect((await request(app).get("/api/vendors/7/staff-roles")).body.canEdit).toBe(false);
  expect((await request(app).put("/api/vendors/7/staff-roles").send({ version: 0, entries: [payroll] })).status).toBe(403);
  expect(state.txExecute).not.toHaveBeenCalled();
});
it("rejects duplicate positions, platform roles, and permission fields", async () => {
  for (const entries of [[payroll, { ...payroll, id: "different", label: "payroll" }], [{ ...payroll, label: "Gatekeeper" }], [{ ...payroll, access: ["admin"] }]]) {
    expect((await request(app).put("/api/vendors/7/staff-roles").send({ version: 0, entries })).status).toBe(400);
  }
  expect(state.txExecute).not.toHaveBeenCalled();
});
it("saves a rename with aliases without writing employee or access records", async () => {
  state.txExecute.mockResolvedValueOnce({ rows: [{ staff_role_catalog: { version: 1, entries: [payroll] } }] }).mockResolvedValueOnce({ rows: [] });
  const result = await request(app).put("/api/vendors/7/staff-roles").send({ version: 1, entries: [{ ...payroll, label: "Payroll Coordinator" }] });
  expect(result.status).toBe(200); expect(result.body.version).toBe(2); expect(result.body.entries[0].aliases).toEqual(["Payroll"]);
  expect(state.txExecute).toHaveBeenCalledTimes(2);
});
it("rejects stale edits rather than overwriting another editor", async () => {
  state.txExecute.mockResolvedValueOnce({ rows: [{ staff_role_catalog: { version: 2, entries: [payroll] } }] });
  expect((await request(app).put("/api/vendors/7/staff-roles").send({ version: 1, entries: [payroll] })).status).toBe(409);
  expect(state.txExecute).toHaveBeenCalledTimes(1);
});
it("retains old definitions and prevents reusing a renamed title", async () => {
  state.txExecute.mockResolvedValue({ rows: [{ staff_role_catalog: { version: 2, entries: [{ ...payroll, label: "Payroll Coordinator", aliases: ["Payroll"] }] } }] });
  expect((await request(app).put("/api/vendors/7/staff-roles").send({ version: 2, entries: [{ id: "new", label: "Payroll", group: "Office" }] })).status).toBe(400);
  expect(state.txExecute).toHaveBeenCalledTimes(1);
});
