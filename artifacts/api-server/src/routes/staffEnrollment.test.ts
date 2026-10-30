import { beforeEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const state = vi.hoisted(() => ({ actor: null as any, allowed: true, send: vi.fn(), list: vi.fn() }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => state.actor }));
vi.mock("../lib/vendor-people-management", () => ({ isVendorOfficeStaff: async (actor: any, vendorId: number) => state.allowed && (actor.role === "admin" || actor.vendorId === vendorId) }));
vi.mock("../services/staff-enrollment", () => ({ StaffEnrollmentError: class extends Error {}, listStaffEnrollments: state.list, sendStaffEnrollment: state.send, previewStaffEnrollment: async () => "<h1>Email preview</h1>" }));
import router from "./staffEnrollment";
const app = express().use(express.json()).use("/api", router);
beforeEach(() => { vi.clearAllMocks(); state.actor = { userId: 1, role: "vendor", vendorId: 7, membershipRole: "admin" }; state.allowed = true; state.list.mockResolvedValue({ entries: {} }); state.send.mockResolvedValue({ state: "sent" }); });
it("rejects signed-out users, other companies, and callers without office/admin rights", async () => {
  state.actor = null; expect((await request(app).get("/api/vendors/7/staff-enrollments")).status).toBe(401);
  state.actor = { userId: 1, role: "vendor", vendorId: 8 }; expect((await request(app).get("/api/vendors/7/staff-enrollments")).status).toBe(403);
  state.actor.vendorId = 7; state.allowed = false; expect((await request(app).post("/api/vendors/7/staff-enrollments/send").send({ key: "person:21", email: "worker@example.com" })).status).toBe(403);
  expect(state.send).not.toHaveBeenCalled();
});
it("routes all three subject types through the same authorized enrollment service", async () => {
  for (const key of ["person:21", "account:25", "worker:11111111-1111-4111-a111-111111111111"]) {
    expect((await request(app).post("/api/vendors/7/staff-enrollments/send").send({ key, email: "worker@example.com" })).status).toBe(200);
    expect(state.send).toHaveBeenLastCalledWith(7, 1, key, "worker@example.com");
  }
});
it("does not report SENT on delivery failure or disclose delivery credentials", async () => {
  state.send.mockRejectedValue(new Error("secret provider detail"));
  const result = await request(app).post("/api/vendors/7/staff-enrollments/send").send({ key: "person:21", email: "worker@example.com" });
  expect(result.status).toBe(502); expect(result.body).not.toHaveProperty("state"); expect(JSON.stringify(result.body)).not.toContain("secret provider detail");
});
it("previews without sending or changing employee accounts", async () => {
  const result = await request(app).get("/api/vendors/7/staff-enrollments/preview?name=Connie");
  expect(result.status).toBe(200); expect(result.headers["content-security-policy"]).toContain("default-src 'none'"); expect(state.send).not.toHaveBeenCalled();
});
