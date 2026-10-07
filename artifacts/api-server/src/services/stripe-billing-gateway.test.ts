import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { createStripeBillingGateway, loadBillingConfig } from "./stripe-billing-gateway";

describe("server-only Stripe configuration and signed raw body", () => {
  it("defaults disabled without real configured prices and matching mode secrets", () => {
    expect(loadBillingConfig({}).enabled).toBe(false);
    expect(() => loadBillingConfig({ VNDRLY_STRIPE_MODE: "typo" })).toThrow("billing.invalid_mode");
    expect(loadBillingConfig({ VNDRLY_STRIPE_BILLING_ENABLED: "1", VNDRLY_STRIPE_SECRET_KEY: "sk_live_fake", VNDRLY_STRIPE_WEBHOOK_SECRET: "whsec_fixture", VNDRLY_STRIPE_PLANS_JSON: '[{"key":"configured","label":"Configured","priceId":"price_Fixture"}]' }).enabled).toBe(false);
    expect(() => loadBillingConfig({ VNDRLY_STRIPE_PLANS_JSON: '[{"key":"invented","label":"Bad","amount":100}]' })).toThrow();
  });
  it("verifies exact raw bytes and rejects altered JSON even with copied signature", () => {
    const config = loadBillingConfig({ VNDRLY_STRIPE_BILLING_ENABLED: "1", VNDRLY_STRIPE_SECRET_KEY: "sk_test_fixture", VNDRLY_STRIPE_WEBHOOK_SECRET: "whsec_fixture", VNDRLY_STRIPE_PLANS_JSON: '[{"key":"configured","label":"Configured","priceId":"price_Fixture"}]' });
    const adapter = createStripeBillingGateway(config, "sk_test_fixture");
    const body = JSON.stringify({ id: "evt_fixture", object: "event", type: "customer.subscription.updated", livemode: false, data: { object: { id: "sub_fixture" } } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_fixture" });
    expect(adapter.verify(Buffer.from(body), signature, "whsec_fixture").id).toBe("evt_fixture");
    expect(() => adapter.verify(Buffer.from(body + " "), signature, "whsec_fixture")).toThrow();
    expect(() => adapter.verify(Buffer.from(body), signature, "whsec_wrong")).toThrow();
  });
});
