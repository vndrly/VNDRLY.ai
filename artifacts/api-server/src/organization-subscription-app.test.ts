import { afterEach, beforeEach, expect, it, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
const mocks = vi.hoisted(() => ({ accept: vi.fn(), db: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: { select: mocks.db },
  usersTable: { id: "id" },
}));
vi.mock("./routes", async () => ({
  default: (await import("express")).Router(),
}));
vi.mock("./routes/assistantConnection", async () => ({
  default: (await import("express")).Router(),
}));
vi.mock("pino-http", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("./lib/requireTenant", () => ({
  requireTenant: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("./services/stripe-billing-repository", () => ({
  createBillingRepository: () => ({}),
}));
vi.mock("./services/stripe-billing", async (original) => ({
  ...(await original<typeof import("./services/stripe-billing")>()),
  createBillingService: () => ({ acceptEvent: mocks.accept }),
}));
// Use the installed SDK's real local signature verifier. No Stripe API is called.
vi.mock("./services/stripe-billing-gateway", async (original) => {
  const real =
    await original<typeof import("./services/stripe-billing-gateway")>();
  return {
    ...real,
    loadBillingConfig: () => ({
      enabled: true,
      mode: "test",
      origin: "https://vndrly.ai",
      plans: [
        { key: "synthetic", label: "Synthetic", priceId: "price_fixture" },
      ],
    }),
    createStripeBillingGateway: (
      config: Parameters<typeof real.createStripeBillingGateway>[0],
    ) =>
      real.createStripeBillingGateway(
        config,
        "sk_test_SYNTHETIC_NONFUNCTIONAL",
      ),
  };
});
import app from "./app";
const fixtureSecret = "whsec_SYNTHETIC_LOCAL_SIGNATURE_ONLY";
const sdk = new Stripe("sk_test_SYNTHETIC_NONFUNCTIONAL");
const payload =
  '{\n "id":"evt_synthetic_app_mount", "type":"customer.subscription.updated", "livemode":false, "data":{"object":{"id":"sub_synthetic","customer":"cus_synthetic"}}\n}';
function signed(body = payload) {
  return sdk.webhooks.generateTestHeaderString({
    payload: body,
    secret: fixtureSecret,
  });
}
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VNDRLY_STRIPE_WEBHOOK_SECRET", fixtureSecret);
  mocks.accept.mockResolvedValue({
    accepted: true,
    subscriptionUpdatePending: true,
  });
});
it("actual app mount verifies exact signed raw bytes before global JSON/session/tenant processing", async () => {
  const response = await request(app)
    .post("/api/organization-subscription/webhook")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", signed())
    .send(payload);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    accepted: true,
    subscriptionUpdatePending: true,
  });
  expect(mocks.accept).toHaveBeenCalledWith({
    id: "evt_synthetic_app_mount",
    type: "customer.subscription.updated",
    livemode: false,
    object: {
      customerId: "cus_synthetic",
      subscriptionId: "sub_synthetic",
      sessionId: undefined,
      paymentStatus: undefined,
    },
  });
  expect(mocks.db).not.toHaveBeenCalled();
});
it("actual mount refuses changed bytes and missing signature without durable acceptance", async () => {
  expect(
    (
      await request(app)
        .post("/api/organization-subscription/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", signed())
        .send(payload + " ")
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post("/api/organization-subscription/webhook")
        .set("Content-Type", "application/json")
        .send(payload)
    ).status,
  ).toBe(400);
  expect(mocks.accept).not.toHaveBeenCalled();
});
it("does not acknowledge failed durable inbox save or open neighboring billing paths anonymously", async () => {
  mocks.accept.mockRejectedValue(Error("synthetic commit failure"));
  const result = await request(app)
    .post("/api/organization-subscription/webhook")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", signed())
    .send(payload);
  expect(result.status).toBe(503);
  expect(result.body.code).toBe("billing.outcome_unverified");
  expect(
    (
      await request(app)
        .post("/api/organization-subscription/checkout")
        .send({})
    ).status,
  ).toBe(401);
});
