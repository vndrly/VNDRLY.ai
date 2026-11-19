import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: { userId: 7, vendorId: 22, role: "vendor" }, validate: vi.fn(), mine: vi.fn(), list: vi.fn(), save: vi.fn() }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => mocks.session }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: mocks.validate }));
vi.mock("../services/employee-subscriptions", async original => ({ ...await original<typeof import("../services/employee-subscriptions")>(), readMyEmployeeSubscriptions: mocks.mine, readEmployeeSubscriptions: mocks.list, saveEmployeeSubscription: mocks.save }));
import router from "./implementationASubscriptions";
const app = express(); app.use(express.json(), router);
beforeEach(() => { vi.clearAllMocks(); mocks.validate.mockResolvedValue(mocks.session); mocks.mine.mockResolvedValue({ subscriptions: [] }); mocks.list.mockResolvedValue({ subscriptions: [], employees: [], canManage: true }); mocks.save.mockResolvedValue({ id: "saved" }); });
it("personal reads always use the authenticated employee, ignoring another requested worker", async () => {
  expect((await request(app).get("/implementation-a/subscriptions/mine?workerUserId=999")).status).toBe(200);
  expect(mocks.mine).toHaveBeenCalledWith(7);
});
it("creates the requested product subscription with its entered billing period and employee", async () => {
  const response = await request(app).post("/implementation-a/subscriptions").send({ operationId: "12345678-1234-4234-9234-123456789abc", name: "Popular Mechanics", employeeKey: "person:5", amountCents: 1900, billingInterval: "year", purpose: "Workshop reference" });
  expect(response.status).toBe(201);
  expect(mocks.save).toHaveBeenCalledWith(mocks.session, expect.objectContaining({ name: "Popular Mechanics", amountCents: 1900, billingInterval: "year", employeeKey: "person:5" }), expect.objectContaining({ operationId: expect.any(String) }));
});
it("refuses access-plan and client-supplied company fields", async () => {
  const response = await request(app).post("/implementation-a/subscriptions").send({ operationId: "12345678-1234-4234-9234-123456789abc", name: "Mail", employeeKey: "person:5", amountCents: 100, billingInterval: "month", plan: "full_worker", vendorId: 999 });
  expect(response.status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects a revoked or changed account before reading or saving", async () => {
  mocks.validate.mockRejectedValueOnce(new Error("revoked"));
  expect((await request(app).get("/implementation-a/subscriptions")).status).toBe(403);
  expect(mocks.list).not.toHaveBeenCalled();
});
