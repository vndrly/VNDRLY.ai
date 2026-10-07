import { Router, raw, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { AssistantOAuthError } from "../assistant/chatgpt-oauth";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { BillingError, billingActorSchema, createBillingService, type BillingTenant } from "../services/stripe-billing";
import { createBillingRepository } from "../services/stripe-billing-repository";
import { createStripeBillingGateway, loadBillingConfig } from "../services/stripe-billing-gateway";

export async function resolveBillingTenant(session: SessionPayload, client?: PoolClient): Promise<BillingTenant> {
  const current = await validateAssistantSession(session, client ? drizzle(client, { schema }) : undefined);
  if (current.membershipRole !== "admin" || !current.activeMembershipId || current.managedSubcontractor) throw new BillingError("billing.current_tenant_admin_required", 403);
  if (current.role === "vendor" && current.vendorId && !current.partnerId) return { type: "vendor", id: current.vendorId };
  if (current.role === "partner" && current.partnerId && !current.vendorId) return { type: "partner", id: current.partnerId };
  throw new BillingError("billing.current_tenant_admin_required", 403);
}
function errorResponse(res: Response, error: unknown) {
  if (error instanceof BillingError) return res.status(error.status).json({ code: error.code });
  if (error instanceof AssistantOAuthError) return res.status(403).json({ code: "billing.current_account_required" });
  if (error instanceof z.ZodError) return res.status(400).json({ code: "billing.invalid_arguments" });
  // Unknown external/commit errors never claim a definitive refusal or payment.
  return res.status(503).json({ code: "billing.outcome_unverified" });
}
const configured = () => {
  const config = loadBillingConfig();
  const adapter = createStripeBillingGateway(config, process.env.VNDRLY_STRIPE_SECRET_KEY || "");
  return { config, adapter, service: createBillingService(config, createBillingRepository(config.mode), adapter.gateway) };
};

/** Mount under /api/organization-subscription within authenticated routes. */
export const organizationSubscriptionRouter = Router();
for (const [method, path, action] of [["get", "/", "status"], ["post", "/checkout", "checkout"], ["post", "/portal", "portal"]] as const) {
  organizationSubscriptionRouter[method](path, async (req: Request, res: Response) => {
    try {
      const session = getSessionFromRequest(req);
      if (!session) throw new BillingError("billing.current_account_required", 401);
      const tenant = await resolveBillingTenant(session);
      const actor = billingActorSchema.parse({ userId: session.userId, membershipId: session.activeMembershipId, sessionVersion: session.sv });
      const authorize = async (client?: PoolClient) => { const current = await resolveBillingTenant(session, client); if (current.type !== tenant.type || current.id !== tenant.id) throw new BillingError("billing.current_account_required", 403); };
      const config = loadBillingConfig();
      if (method === "post" && req.headers.origin !== config.origin) throw new BillingError("billing.current_origin_required", 403);
      if (!config.enabled && action === "status") return res.json({ configured: false, plans: [], customerLinked: false, subscription: null, accessEnforcementImplemented: false });
      const { service } = configured();
      return res.json(action === "status" ? await service.status(tenant, authorize) : action === "checkout" ? await service.checkout(tenant, req.body, authorize, actor) : await service.portal(tenant, req.body, authorize, actor));
    } catch (error) { return errorResponse(res, error); }
  });
}

/** Mount exact POST /api/organization-subscription/webhook BEFORE express.json.
 * This signed endpoint alone bypasses sessions; no broad public allowlist required.
 */
export const organizationSubscriptionWebhook = Router();
organizationSubscriptionWebhook.post("/", raw({ type: "application/json", limit: "512kb" }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || typeof req.headers["stripe-signature"] !== "string") throw new BillingError("billing.invalid_signature", 400);
    const { config, adapter, service } = configured();
    let event;
    try { event = adapter.verify(req.body, req.headers["stripe-signature"], process.env.VNDRLY_STRIPE_WEBHOOK_SECRET || ""); }
    catch { throw new BillingError("billing.invalid_signature", 400); }
    if (event.livemode !== (config.mode === "live")) throw new BillingError("billing.mode_mismatch", 400);
    // VNDRLY SaaS billing is the platform's own account, never connected-account settlement.
    if (event.account) return res.json({ ignored: true });
    const types = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
    if (!types.includes(event.type)) return res.json({ ignored: true });
    const saved = event.data.object as unknown as { id: string; customer: string | { id: string }; subscription?: string | { id: string } | null; payment_status?: string };
    const customerId = typeof saved.customer === "string" ? saved.customer : saved.customer?.id;
    if (!customerId) throw new BillingError("billing.invalid_event", 400);
    const subscriptionId = event.type.startsWith("customer.subscription.") ? saved.id : typeof saved.subscription === "string" ? saved.subscription : saved.subscription?.id;
    return res.json(await service.acceptEvent({ id: event.id, type: event.type, livemode: event.livemode, object: { customerId, subscriptionId, sessionId: event.type.startsWith("checkout.") ? saved.id : undefined, paymentStatus: saved.payment_status } }));
  } catch (error) { return errorResponse(res, error); }
});
