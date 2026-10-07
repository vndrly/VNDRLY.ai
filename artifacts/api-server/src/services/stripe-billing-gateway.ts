import Stripe from "stripe";
import { createHash } from "node:crypto";
import { BillingError, billingCatalogSchema, type BillingConfig, type BillingGateway, type BillingSubscription } from "./stripe-billing";

export function loadBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  if (env.VNDRLY_STRIPE_MODE && !["test", "live"].includes(env.VNDRLY_STRIPE_MODE)) throw new BillingError("billing.invalid_mode", 503);
  const mode = env.VNDRLY_STRIPE_MODE === "live" ? "live" : "test";
  const plans = billingCatalogSchema.parse(JSON.parse(env.VNDRLY_STRIPE_PLANS_JSON || "[]"));
  const origin = new URL(env.VNDRLY_BILLING_ORIGIN || "https://vndrly.ai");
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new BillingError("billing.invalid_origin", 503);
  const secret = env.VNDRLY_STRIPE_SECRET_KEY;
  const keyMatches = Boolean(secret?.startsWith(`sk_${mode}_`) || secret?.startsWith(`rk_${mode}_`));
  return { mode, plans, origin: origin.origin, enabled: env.VNDRLY_STRIPE_BILLING_ENABLED === "1" && keyMatches && Boolean(env.VNDRLY_STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) && plans.length > 0 };
}

/** No client is instantiated without server configuration. No SDK keys enter projections. */
export function createStripeBillingGateway(config: BillingConfig, secret: string): { gateway: BillingGateway; verify: (body: Buffer, signature: string, webhookSecret: string) => Stripe.Event } {
  if (!config.enabled) throw new BillingError("billing.not_configured", 503);
  // Keep the installed SDK's tested API version; upgrade SDK/version together later.
  const client = new Stripe(secret, { timeout: 10_000, maxNetworkRetries: 1 });
  const integrationId = (operationId: string) => "vndrly_subscription_" + Array.from(createHash("sha256").update(operationId).digest().subarray(0, 8), byte => String.fromCharCode(97 + byte % 26)).join("");
  const retrieveSubscription = async (id: string): Promise<BillingSubscription> => {
    const saved = await client.subscriptions.retrieve(id);
    if (saved.livemode !== (config.mode === "live")) throw new BillingError("billing.mode_mismatch", 409);
    return { id: saved.id, customerId: typeof saved.customer === "string" ? saved.customer : saved.customer.id, status: saved.status,
      priceIds: saved.items.data.map(item => item.price.id), cancelAtPeriodEnd: saved.cancel_at_period_end, observedAt: new Date().toISOString() };
  };
  return {
    verify: (body, signature, webhookSecret) => client.webhooks.constructEvent(body, signature, webhookSecret),
    gateway: {
      async createCustomer(tenant, idempotencyKey) { return (await client.customers.create({ metadata: { vndrly_tenant_type: tenant.type, vndrly_tenant_id: String(tenant.id) } }, { idempotencyKey })).id; },
      async checkout(customerId, priceId, tenant, operationId, origin) {
        const price = await client.prices.retrieve(priceId);
        if (!price.active || !price.recurring || price.livemode !== (config.mode === "live")) throw new BillingError("billing.price_unavailable", 409);
        const session = await client.checkout.sessions.create({ mode: "subscription", customer: customerId, line_items: [{ price: priceId, quantity: 1 }],
          success_url: `${origin}/organization-subscription?checkout=returned`, cancel_url: `${origin}/organization-subscription`,
          client_reference_id: `${tenant.type}:${tenant.id}`, metadata: { vndrly_operation_id: operationId, vndrly_tenant_type: tenant.type, vndrly_tenant_id: String(tenant.id) }, integration_identifier: integrationId(operationId),
        }, { idempotencyKey: `vndrly-checkout:${config.mode}:${tenant.type}:${tenant.id}:${operationId}` });
        if (!session.url) throw new BillingError("billing.session_unavailable", 502);
        return { id: session.id, url: session.url };
      },
      async portal(customerId, operationId, origin) {
        const session = await client.billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/organization-subscription` }, { idempotencyKey: `vndrly-portal:${config.mode}:${customerId}:${operationId}` });
        return { id: session.id, url: session.url };
      },
      retrieveSubscription,
      async retrieveCheckout(id) {
        const saved = await client.checkout.sessions.retrieve(id);
        const items = await client.checkout.sessions.listLineItems(id, { limit: 2 });
        if (saved.livemode !== (config.mode === "live") || saved.mode !== "subscription" || items.has_more || items.data.length !== 1 || !items.data[0]?.price || !saved.customer || !saved.metadata?.vndrly_operation_id || !saved.status) throw new BillingError("billing.checkout_binding_unverified", 409);
        const tenant = { type: saved.metadata.vndrly_tenant_type, id: Number(saved.metadata.vndrly_tenant_id) };
        if (tenant.type !== "vendor" && tenant.type !== "partner") throw new BillingError("billing.checkout_binding_unverified", 409);
        if (saved.client_reference_id !== `${tenant.type}:${tenant.id}`) throw new BillingError("billing.checkout_binding_unverified", 409);
        return { tenant: { type: tenant.type, id: tenant.id }, customerId: typeof saved.customer === "string" ? saved.customer : saved.customer.id, operationId: saved.metadata.vndrly_operation_id, priceId: items.data[0].price.id, subscriptionId: typeof saved.subscription === "string" ? saved.subscription : saved.subscription?.id ?? null, paymentStatus: saved.payment_status, status: saved.status };
      },
    },
  };
}
