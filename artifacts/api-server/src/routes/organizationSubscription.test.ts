import { beforeEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const mocks = vi.hoisted(() => ({ current: vi.fn(), session: vi.fn(), verify: vi.fn(), accept: vi.fn() }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: mocks.current }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: mocks.session }));
vi.mock("../services/stripe-billing-repository", () => ({ createBillingRepository: () => ({}) }));
vi.mock("../services/stripe-billing", async original => ({ ...(await original<typeof import("../services/stripe-billing")>()), createBillingService: () => ({ acceptEvent: mocks.accept }) }));
vi.mock("../services/stripe-billing-gateway", () => ({ loadBillingConfig: () => ({ enabled: true, mode: "test", origin: "https://vndrly.ai" }), createStripeBillingGateway: () => ({ verify: mocks.verify, gateway: {} }) }));
import { resolveBillingTenant, organizationSubscriptionRouter, organizationSubscriptionWebhook } from "./organizationSubscription";
beforeEach(() => { vi.clearAllMocks(); mocks.current.mockResolvedValue({ role: "vendor", vendorId: 42, membershipRole: "admin", activeMembershipId: 1 }); mocks.session.mockReturnValue({ userId: 9, role: "vendor", vendorId: 42, activeMembershipId: 1, sv: 1 }); mocks.accept.mockResolvedValue({ accepted: true }); });
it("uses current exact tenant admin only and denies member/platform override", async () => {
  expect(await resolveBillingTenant({ userId: 9 })).toEqual({ type: "vendor", id: 42 });
  for (const current of [{ role: "vendor", vendorId: 42, membershipRole: "member", activeMembershipId: 1 }, { role: "admin", vendorId: 42, membershipRole: "admin", activeMembershipId: 1 }]) {
    mocks.current.mockResolvedValue(current);
    await expect(resolveBillingTenant({ userId: 9 })).rejects.toMatchObject({ status: 403 });
  }
});
it("rejects cross-origin cookie writes before creating hosted sessions", async () => {
  const app = express(); app.use(express.json()); app.use("/billing", organizationSubscriptionRouter);
  const result = await request(app).post("/billing/checkout").set("Origin", "https://foreign.example").send({ operationId: "00000000-0000-4000-8000-000000000001", planKey: "configured" });
  expect(result.status).toBe(403); expect(result.body.code).toBe("billing.current_origin_required");
});
it("passes untouched raw webhook bytes to signature verification before JSON and only acknowledges durable acceptance", async () => {
  const app = express(); app.use("/webhook", organizationSubscriptionWebhook); app.use(express.json());
  mocks.verify.mockReturnValue({ id: "evt_fixture", type: "customer.subscription.updated", livemode: false, data: { object: { id: "sub_fixture", customer: "cus_fixture" } } });
  const payload = '{ "exact": "raw bytes" }';
  const result = await request(app).post("/webhook").set("Content-Type", "application/json").set("Stripe-Signature", "fixture-signature").send(payload);
  expect(result.status).toBe(200); expect(mocks.verify.mock.calls[0][0].equals(Buffer.from(payload))).toBe(true); expect(mocks.accept).toHaveBeenCalledTimes(1);
  mocks.verify.mockImplementation(() => { throw Error("tampered"); });
  expect((await request(app).post("/webhook").set("Content-Type", "application/json").set("Stripe-Signature", "wrong").send(payload)).status).toBe(400);
  expect(mocks.accept).toHaveBeenCalledTimes(1);
});
