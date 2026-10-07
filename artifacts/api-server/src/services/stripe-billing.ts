import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { PoolClient } from "pg";

export const billingTenantSchema = z.object({ type: z.enum(["vendor", "partner"]), id: z.number().int().positive() }).strict();
export type BillingTenant = z.infer<typeof billingTenantSchema>;
export const billingPlanSchema = z.object({ key: z.string().regex(/^[a-z0-9_-]{1,64}$/), label: z.string().min(1).max(100), priceId: z.string().regex(/^price_[A-Za-z0-9]+$/) }).strict();
export const billingCatalogSchema = z.array(billingPlanSchema).max(30).superRefine((plans, ctx) => {
  if (new Set(plans.map(p => p.key)).size !== plans.length || new Set(plans.map(p => p.priceId)).size !== plans.length) ctx.addIssue({ code: "custom", message: "Billing plans must be unique" });
});
export const billingCheckoutInput = z.object({ operationId: z.uuid(), planKey: z.string().min(1).max(64) }).strict();
export const billingPortalInput = z.object({ operationId: z.uuid() }).strict();
const subscriptionSchema = z.object({ id: z.string(), customerId: z.string(), status: z.enum(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]), priceIds: z.array(z.string()).max(100), cancelAtPeriodEnd: z.boolean(), observedAt: z.string().datetime() }).strict();
export type BillingSubscription = z.infer<typeof subscriptionSchema>;
export const billingActorSchema = z.object({ userId: z.number().int().positive(), membershipId: z.number().int().positive(), sessionVersion: z.number().int().positive() }).strict();
export type BillingActor = z.infer<typeof billingActorSchema>;
const receiptSchema = z.object({ actor: billingActorSchema, fingerprint: z.string(), kind: z.enum(["checkout", "portal"]), url: z.string().url().nullable(), sessionId: z.string(), createdAt: z.string().datetime() }).strict();
export const billingEventSchema = z.object({ id: z.string().min(1).max(255), type: z.string().max(100), livemode: z.boolean(), object: z.object({ customerId: z.string().min(1).max(255), subscriptionId: z.string().max(255).optional(), sessionId: z.string().max(255).optional(), paymentStatus: z.string().max(50).optional() }).strict() }).strict();
export type BillingEvent = z.infer<typeof billingEventSchema>;
export const billingInboxEntrySchema = z.object({ event: billingEventSchema, receivedAt: z.string().datetime(), nextAttemptAt: z.string().datetime(), attempts: z.number().int().nonnegative() }).strict();
export const billingStateSchema = z.object({
  schemaVersion: z.literal(1), mode: z.enum(["test", "live"]), customerId: z.string().nullable(),
  customerAttemptAt: z.string().datetime().nullable(), customerAttemptActor: billingActorSchema.nullable(), subscription: subscriptionSchema.nullable(),
  operations: z.record(z.string(), receiptSchema), checkoutSessions: z.record(z.string(), z.string()),
  checkoutAttempts: z.record(z.string(), z.object({ actor: billingActorSchema, fingerprint: z.string(), startedAt: z.string().datetime(), refusalCode: z.enum(["billing.price_unavailable", "billing.use_portal"]).nullable() }).strict()),
  events: z.record(z.string(), z.object({ type: z.string(), processedAt: z.string().datetime() }).strict()),
  inbox: z.record(z.string(), billingInboxEntrySchema),
}).strict();
export type BillingState = z.infer<typeof billingStateSchema>;
export type BillingConfig = { mode: "test" | "live"; plans: z.infer<typeof billingCatalogSchema>; origin: string; enabled: boolean };
export interface BillingStore {
  withTenant<T>(tenant: BillingTenant, action: (state: BillingState, client?: PoolClient) => Promise<T>): Promise<T>;
  findCustomer(customerId: string): Promise<BillingTenant | null>;
  pendingEvents(limit: number): Promise<BillingEvent[]>;
}
export interface BillingGateway {
  createCustomer(tenant: BillingTenant, idempotencyKey: string): Promise<string>;
  checkout(customerId: string, priceId: string, tenant: BillingTenant, operationId: string, origin: string): Promise<{ id: string; url: string }>;
  portal(customerId: string, operationId: string, origin: string): Promise<{ id: string; url: string }>;
  retrieveSubscription(id: string): Promise<BillingSubscription>;
  retrieveCheckout(id: string): Promise<{ customerId: string; operationId: string; tenant: BillingTenant; priceId: string; subscriptionId: string | null; paymentStatus: string; status: "open" | "complete" | "expired" }>;
}
export class BillingError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export const tenantKey = (tenant: BillingTenant) => `${tenant.type}:${tenant.id}`;
export const newBillingState = (mode: "test" | "live"): BillingState => ({ schemaVersion: 1, mode, customerId: null, customerAttemptAt: null, customerAttemptActor: null, subscription: null, operations: {}, checkoutSessions: {}, checkoutAttempts: {}, events: {}, inbox: {} });
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const enabled = (config: BillingConfig) => { if (!config.enabled || !config.plans.length) throw new BillingError("billing.not_configured", 503); };
const modeMatches = (state: BillingState, config: BillingConfig) => { if (state.mode !== config.mode) throw new BillingError("billing.mode_mismatch", 409); };

/** Authority is injected by the canonical router and rechecked inside the durable lock. */
export function createBillingService(config: BillingConfig, store: BillingStore, gateway: BillingGateway, now = () => new Date()) {
  return {
    async status(tenant: BillingTenant, authorize: (client?: PoolClient) => Promise<void>) {
      await authorize();
      return store.withTenant(tenant, async (state, client) => {
        await authorize(client); modeMatches(state, config);
        const subscription = state.subscription;
        const plan = subscription && subscription.priceIds.length === 1 ? config.plans.find(p => p.priceId === subscription.priceIds[0]) : undefined;
        return { configured: config.enabled && config.plans.length > 0, plans: config.plans.map(({ key, label }) => ({ key, label })),
          customerLinked: Boolean(state.customerId), subscription: subscription ? { status: subscription.status, planKey: plan?.key ?? null, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, observedAt: subscription.observedAt } : null,
          source: "verified_stripe_records" as const, accessEnforcementImplemented: false as const };
      });
    },
    async checkout(tenant: BillingTenant, raw: unknown, authorize: (client?: PoolClient) => Promise<void>, actor: BillingActor) {
      billingActorSchema.parse(actor);
      const input = billingCheckoutInput.parse(raw); enabled(config);
      const plan = config.plans.find(p => p.key === input.planKey);
      if (!plan) throw new BillingError("billing.plan_unavailable");
      await authorize();
      // Customer creation intent is committed BEFORE external creation. A dropped
      // response may reuse its stable key only within Stripe's retention window.
      const customerId = await store.withTenant(tenant, async (state, client) => {
        await authorize(client); modeMatches(state, config);
        if (state.customerId) return state.customerId;
        if (!state.customerAttemptAt) { state.customerAttemptAt = now().toISOString(); state.customerAttemptActor = actor; }
        if (now().getTime() - Date.parse(state.customerAttemptAt) > 23 * 60 * 60 * 1000) throw new BillingError("billing.customer_outcome_unknown", 409);
        return null;
      });
      let customer = customerId;
      if (!customer) {
        await authorize();
        const created = await gateway.createCustomer(tenant, `vndrly-customer:${config.mode}:${tenantKey(tenant)}`);
        customer = await store.withTenant(tenant, async (state, client) => { await authorize(client); modeMatches(state, config); if (state.customerId && state.customerId !== created) throw new BillingError("billing.customer_mismatch", 409); state.customerId = created; return created; });
      }
      const hash = fingerprint({ kind: "checkout", tenant, planKey: plan.key, priceId: plan.priceId });
      await store.withTenant(tenant, async (state, client) => {
        await authorize(client); modeMatches(state, config);
        const attempt = state.checkoutAttempts[input.operationId];
        if (attempt && attempt.fingerprint !== hash) throw new BillingError("billing.operation_conflict", 409);
        if (attempt?.refusalCode) throw new BillingError(attempt.refusalCode, 409);
        if (!attempt) {
          if (state.subscription && !["canceled", "incomplete_expired"].includes(state.subscription.status)) throw new BillingError("billing.use_portal", 409);
          for (const attemptId of Object.keys(state.checkoutAttempts)) {
            if (state.checkoutAttempts[attemptId]!.refusalCode) continue;
            const previous = state.operations[attemptId];
            if (!previous) throw new BillingError("billing.checkout_outcome_unknown", 409);
            if (previous.kind !== "checkout") continue;
            const session = await gateway.retrieveCheckout(previous.sessionId);
            if (session.customerId !== state.customerId || tenantKey(session.tenant) !== tenantKey(tenant) || session.operationId !== attemptId) throw new BillingError("billing.checkout_binding_unverified", 409);
            if (session.status === "open") throw new BillingError("billing.checkout_pending", 409);
            if (session.status === "complete" && session.paymentStatus === "paid" && !state.subscription) throw new BillingError("billing.subscription_update_pending", 409);
          }
          await authorize(client);
          state.checkoutAttempts[input.operationId] = { actor, fingerprint: hash, startedAt: now().toISOString(), refusalCode: null };
        }
      });
      try { return await store.withTenant(tenant, async (state, client) => {
        await authorize(client); modeMatches(state, config);
        const saved = state.operations[input.operationId];
        if (saved) { if (saved.fingerprint !== hash || saved.kind !== "checkout") throw new BillingError("billing.operation_conflict", 409); return { url: saved.url, sessionId: saved.sessionId, paymentVerified: false as const }; }
        if (now().getTime() - Date.parse(state.checkoutAttempts[input.operationId]!.startedAt) > 23 * 60 * 60 * 1000) throw new BillingError("billing.checkout_outcome_unknown", 409);
        if (state.subscription && !["canceled", "incomplete_expired"].includes(state.subscription.status)) throw new BillingError("billing.use_portal", 409);
        const result = await gateway.checkout(customer!, plan.priceId, tenant, input.operationId, config.origin);
        await authorize(client);
        state.operations[input.operationId] = { actor: state.checkoutAttempts[input.operationId]!.actor, kind: "checkout", fingerprint: hash, url: result.url, sessionId: result.id, createdAt: now().toISOString() };
        state.checkoutSessions[result.id] = plan.priceId;
        return { url: result.url, sessionId: result.id, paymentVerified: false as const };
      }); } catch (error) {
        // This adapter code is emitted only before checkout.sessions.create.
        // Keep audit provenance while allowing a fresh explicit request after
        // configuration repair. Network/commit/session errors remain unknown.
        if (error instanceof BillingError && ["billing.price_unavailable", "billing.use_portal"].includes(error.code)) {
          await store.withTenant(tenant, async (state, client) => {
            await authorize(client);
            const attempt = state.checkoutAttempts[input.operationId];
            if (attempt?.fingerprint === hash && !state.operations[input.operationId]) attempt.refusalCode = error.code as "billing.price_unavailable" | "billing.use_portal";
          });
        }
        throw error;
      }
    },
    async portal(tenant: BillingTenant, raw: unknown, authorize: (client?: PoolClient) => Promise<void>, actor: BillingActor) {
      billingActorSchema.parse(actor);
      const input = billingPortalInput.parse(raw); enabled(config); await authorize();
      return store.withTenant(tenant, async (state, client) => {
        await authorize(client); modeMatches(state, config);
        if (!state.customerId) throw new BillingError("billing.customer_not_linked", 409);
        // Portal URLs are short-lived: create only from an explicit new operation.
        const hash = fingerprint({ kind: "portal", tenant }); const saved = state.operations[input.operationId];
        if (saved) { if (saved.kind !== "portal" || saved.fingerprint !== hash) throw new BillingError("billing.operation_conflict", 409); return { url: saved.url }; }
        const result = await gateway.portal(state.customerId, input.operationId, config.origin); await authorize(client);
        state.operations[input.operationId] = { actor, kind: "portal", fingerprint: hash, url: result.url, sessionId: result.id, createdAt: now().toISOString() };
        return { url: result.url };
      });
    },
    async acceptEvent(raw: unknown) {
      const event = billingEventSchema.parse(raw);
      if (event.livemode !== (config.mode === "live")) throw new BillingError("billing.mode_mismatch", 400);
      const tenant = await store.findCustomer(event.object.customerId);
      if (!tenant) return { ignored: true, reason: "unbound_customer" };
      return store.withTenant(tenant, async (state, client) => {
        modeMatches(state, config);
        if (state.customerId !== event.object.customerId) throw new BillingError("billing.customer_mismatch", 409);
        if (state.events[event.id]) return { duplicate: true };
        const saved = state.inbox[event.id];
        if (saved && fingerprint(saved.event) !== fingerprint(event)) throw new BillingError("billing.event_conflict", 409);
        if (!saved) state.inbox[event.id] = { event, receivedAt: now().toISOString(), nextAttemptAt: now().toISOString(), attempts: 0 };
        return { accepted: true, subscriptionUpdatePending: true };
      });
    },
    async deferEvent(event: BillingEvent) {
      const tenant = await store.findCustomer(event.object.customerId);
      if (!tenant) return;
      await store.withTenant(tenant, async state => {
        const entry = state.inbox[event.id];
        if (!entry || fingerprint(entry.event) !== fingerprint(event)) return;
        entry.attempts = Math.min(1_000_000, entry.attempts + 1);
        entry.nextAttemptAt = new Date(now().getTime() + Math.min(3_600_000, 30_000 * 2 ** Math.min(7, entry.attempts - 1))).toISOString();
      });
    },
    async processEvent(event: BillingEvent) {
      if (event.livemode !== (config.mode === "live")) throw new BillingError("billing.mode_mismatch", 400);
      const tenant = await store.findCustomer(event.object.customerId);
      if (!tenant) return { ignored: true, reason: "unbound_customer" };
      return store.withTenant(tenant, async (state, client) => {
        modeMatches(state, config);
        if (state.customerId !== event.object.customerId) throw new BillingError("billing.customer_mismatch", 409);
        if (state.events[event.id]) return { duplicate: true };
        const checkout = ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type);
        const subscriptionEvent = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type);
        if (checkout && event.object.paymentStatus === "paid" && event.object.sessionId && event.object.subscriptionId) {
          if (!state.checkoutSessions[event.object.sessionId]) {
            // The webhook can recover a Checkout whose creation response/DB commit
            // was dropped. Metadata alone never creates an authorized intent.
            const saved = await gateway.retrieveCheckout(event.object.sessionId);
            const plan = config.plans.find(p => p.priceId === saved.priceId);
            const attempt = state.checkoutAttempts[saved.operationId];
            if (!plan || !attempt || saved.customerId !== state.customerId || tenantKey(saved.tenant) !== tenantKey(tenant) || saved.subscriptionId !== event.object.subscriptionId || saved.paymentStatus !== "paid" || attempt.fingerprint !== fingerprint({ kind: "checkout", tenant, planKey: plan.key, priceId: plan.priceId })) throw new BillingError("billing.checkout_binding_unverified", 409);
            state.checkoutSessions[event.object.sessionId] = saved.priceId;
            state.operations[saved.operationId] = { actor: attempt.actor, fingerprint: attempt.fingerprint, kind: "checkout", url: null, sessionId: event.object.sessionId, createdAt: now().toISOString() };
          }
          const current = await gateway.retrieveSubscription(event.object.subscriptionId);
          if (current.customerId !== state.customerId || current.id !== event.object.subscriptionId) throw new BillingError("billing.subscription_mismatch", 409);
          if (state.subscription && state.subscription.id !== current.id && !["canceled", "incomplete_expired"].includes(state.subscription.status)) throw new BillingError("billing.subscription_conflict", 409);
          state.subscription = current;
        } else if (subscriptionEvent && event.object.subscriptionId && state.subscription?.id === event.object.subscriptionId) {
          const current = await gateway.retrieveSubscription(event.object.subscriptionId);
          if (current.customerId !== state.customerId || current.id !== state.subscription.id) throw new BillingError("billing.subscription_mismatch", 409);
          state.subscription = current;
        }
        state.events[event.id] = { type: event.type, processedAt: now().toISOString() };
        delete state.inbox[event.id];
        return { processed: true };
      });
    },
  };
}
