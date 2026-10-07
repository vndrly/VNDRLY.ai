import { describe, it, expect, vi } from "vitest";
import { BillingError, createBillingService, newBillingState, tenantKey, type BillingConfig, type BillingGateway, type BillingState, type BillingStore, type BillingTenant } from "./stripe-billing";

const tenant = { type: "vendor", id: 42 } as const;
const actor = { userId: 9, membershipId: 1, sessionVersion: 1 };
const op = "00000000-0000-4000-8000-000000000001";
const config: BillingConfig = { enabled: true, mode: "test", origin: "https://vndrly.ai", plans: [{ key: "configured", label: "Configured plan", priceId: "price_Configured" }] };
function fixture() {
  const states = new Map<string, BillingState>();
  states.set(tenantKey(tenant), newBillingState("test"));
  let queue = Promise.resolve();
  const store: BillingStore = {
    withTenant<T>(owner: BillingTenant, action: (state: BillingState) => Promise<T>): Promise<T> {
      const run = queue.then(async () => { const state = structuredClone(states.get(tenantKey(owner)) ?? newBillingState("test")); const result = await action(state); states.set(tenantKey(owner), state); return result; });
      queue = run.then(() => undefined, () => undefined); return run;
    },
    async findCustomer(id) { for (const [key, value] of states) if (value.customerId === id) { const [type, ownerId] = key.split(":"); return { type: type as BillingTenant["type"], id: Number(ownerId) }; } return null; },
    async pendingEvents(limit) { return [...states.values()].flatMap(s => Object.values(s.inbox)).filter(e => Date.parse(e.nextAttemptAt) <= new Date("2026-10-07T10:00:00Z").getTime()).sort((a,b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt)).slice(0, limit).map(e => e.event); },
  };
  const gateway: BillingGateway = {
    createCustomer: vi.fn(async () => "cus_Fixture"),
    checkout: vi.fn(async () => ({ id: "cs_Fixture", url: "https://checkout.stripe.com/c/pay/fixture" })),
    portal: vi.fn(async () => ({ id: "bps_Fixture", url: "https://billing.stripe.com/p/session/fixture" })),
    retrieveSubscription: vi.fn(async (id: string) => ({ id, customerId: "cus_Fixture", status: "active" as const, priceIds: ["price_Configured"], cancelAtPeriodEnd: false, observedAt: "2026-10-07T10:00:00Z" })),
    retrieveCheckout: vi.fn(async () => ({ customerId: "cus_Fixture", operationId: op, tenant, priceId: "price_Configured", subscriptionId: "sub_Fixture", paymentStatus: "paid", status: "complete" as const })),
  };
  const authorize = vi.fn(async () => undefined);
  const service = createBillingService(config, store, gateway, () => new Date("2026-10-07T10:00:00Z"));
  const event = (id: string, paymentStatus = "paid") => ({ id, type: "checkout.session.completed", livemode: false, object: { customerId: "cus_Fixture", subscriptionId: "sub_Fixture", sessionId: "cs_Fixture", paymentStatus } });
  return { service, states, store, gateway, authorize, event };
}

describe("VNDRLY organization subscription foundation", () => {
  it("refuses disabled/unconfigured plans and client prices/tenant overrides before external effects", async () => {
    const f = fixture();
    await expect(createBillingService({ ...config, enabled: false }, f.store, f.gateway).checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor)).rejects.toMatchObject({ code: "billing.not_configured" });
    await expect(f.service.checkout(tenant, { operationId: op, planKey: "invented" }, f.authorize, actor)).rejects.toMatchObject({ code: "billing.plan_unavailable" });
    await expect(f.service.checkout(tenant, { operationId: op, planKey: "configured", priceId: "price_Else", owner: { id: 999 } }, f.authorize, actor)).rejects.toThrow();
    expect(f.gateway.createCustomer).not.toHaveBeenCalled();
  });
  it("serializes duplicate Checkout intents, keeps exact receipts, and never treats redirect as payment", async () => {
    const f = fixture(); const input = { operationId: op, planKey: "configured" };
    const results = await Promise.all([f.service.checkout(tenant, input, f.authorize, actor), f.service.checkout(tenant, input, f.authorize, actor)]);
    expect(results[0]).toEqual(results[1]); expect(results[0].paymentVerified).toBe(false);
    expect(f.gateway.checkout).toHaveBeenCalledTimes(1);
    expect((await f.service.status(tenant, f.authorize)).subscription).toBeNull();
  });
  it("does not create competing Checkout sessions while an earlier one is open or uncertain", async () => {
    const f = fixture(); await f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor);
    vi.mocked(f.gateway.retrieveCheckout).mockResolvedValue({ customerId: "cus_Fixture", operationId: op, tenant, priceId: "price_Configured", subscriptionId: null, paymentStatus: "unpaid", status: "open" });
    const next = { operationId: "00000000-0000-4000-8000-000000000002", planKey: "configured" };
    await expect(f.service.checkout(tenant, next, f.authorize, actor)).rejects.toMatchObject({ code: "billing.checkout_pending" });
    expect(f.states.get(tenantKey(tenant))!.checkoutAttempts[next.operationId]).toBeUndefined();
    expect(f.gateway.checkout).toHaveBeenCalledTimes(1);
    vi.mocked(f.gateway.retrieveCheckout).mockResolvedValue({ customerId: "cus_Fixture", operationId: op, tenant, priceId: "price_Configured", subscriptionId: null, paymentStatus: "unpaid", status: "expired" });
    await f.service.checkout(tenant, next, f.authorize, actor);
    expect(f.gateway.checkout).toHaveBeenCalledTimes(2);
  });
  it("does not poison future checkout after a definitive existing subscription or pre-create price refusal", async () => {
    const f = fixture(); const state = f.states.get(tenantKey(tenant))!;
    state.customerId = "cus_Fixture";
    state.subscription = { id: "sub_Fixture", customerId: "cus_Fixture", status: "active", priceIds: ["price_Configured"], cancelAtPeriodEnd: false, observedAt: "2026-10-07T10:00:00Z" };
    await expect(f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor)).rejects.toMatchObject({ code: "billing.use_portal" });
    expect(f.states.get(tenantKey(tenant))!.checkoutAttempts).toEqual({});
    f.states.get(tenantKey(tenant))!.subscription!.status = "canceled";
    vi.mocked(f.gateway.checkout).mockRejectedValueOnce(new BillingError("billing.price_unavailable", 409));
    await expect(f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor)).rejects.toMatchObject({ code: "billing.price_unavailable" });
    expect(f.states.get(tenantKey(tenant))!.checkoutAttempts[op]!.refusalCode).toBe("billing.price_unavailable");
    await f.service.checkout(tenant, { operationId: "00000000-0000-4000-8000-000000000002", planKey: "configured" }, f.authorize, actor);
    expect(f.gateway.checkout).toHaveBeenCalledTimes(2);
  });
  it("records definitive refusal if a subscription becomes active between reservation and send", async () => {
    const f = fixture(); const state = f.states.get(tenantKey(tenant))!;
    state.customerId = "cus_Fixture";
    state.subscription = { id: "sub_Fixture", customerId: "cus_Fixture", status: "canceled", priceIds: ["price_Configured"], cancelAtPeriodEnd: false, observedAt: "2026-10-07T10:00:00Z" };
    let raced=false;
    const store: BillingStore = { ...f.store, async withTenant(owner, action) { const result=await f.store.withTenant(owner,action);const current=f.states.get(tenantKey(owner))!;if(!raced&&current.checkoutAttempts[op]&&!current.operations[op]){raced=true;current.subscription!.status="active";}return result; } };
    const service=createBillingService(config,store,f.gateway);
    await expect(service.checkout(tenant,{operationId:op,planKey:"configured"},f.authorize,actor)).rejects.toMatchObject({code:"billing.use_portal"});
    expect(f.gateway.checkout).not.toHaveBeenCalled();expect(f.states.get(tenantKey(tenant))!.checkoutAttempts[op]?.refusalCode).toBe("billing.use_portal");
    f.states.get(tenantKey(tenant))!.subscription!.status="canceled";
    await service.checkout(tenant,{operationId:"00000000-0000-4000-8000-000000000002",planKey:"configured"},f.authorize,actor);
    expect(f.gateway.checkout).toHaveBeenCalledTimes(1);
  });
  it("gates paid fulfillment and deduplicates signed-event processing with current subscription reconciliation", async () => {
    const f = fixture(); await f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor);
    await f.service.processEvent(f.event("evt_Unpaid", "unpaid")); expect(f.gateway.retrieveSubscription).not.toHaveBeenCalled();
    await f.service.processEvent(f.event("evt_Paid")); await f.service.processEvent(f.event("evt_Paid"));
    expect(f.gateway.retrieveSubscription).toHaveBeenCalledTimes(1);
    vi.mocked(f.gateway.retrieveSubscription).mockResolvedValue({ id: "sub_Fixture", customerId: "cus_Fixture", status: "canceled", priceIds: ["price_Configured"], cancelAtPeriodEnd: false, observedAt: "2026-10-07T11:00:00Z" });
    await f.service.processEvent({ id: "evt_OldUpdate", type: "customer.subscription.updated", livemode: false, object: { customerId: "cus_Fixture", subscriptionId: "sub_Fixture" } });
    expect((await f.service.status(tenant, f.authorize)).subscription?.status).toBe("canceled");
  });
  it("recovers dropped Checkout creation using persisted exact intent, not arbitrary Stripe metadata", async () => {
    const f = fixture(); vi.mocked(f.gateway.checkout).mockRejectedValueOnce(Error("response dropped after Stripe save"));
    await expect(f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor)).rejects.toThrow();
    expect(f.states.get(tenantKey(tenant))!.checkoutAttempts[op]).toBeDefined();
    await f.service.processEvent(f.event("evt_Recover"));
    expect((await f.service.status(tenant, f.authorize)).subscription?.status).toBe("active");
    expect(f.states.get(tenantKey(tenant))!.operations[op]).toMatchObject({ sessionId: "cs_Fixture", actor, url: null });
    f.states.get(tenantKey(tenant))!.subscription!.status = "canceled";
    await f.service.checkout(tenant, { operationId: "00000000-0000-4000-8000-000000000002", planKey: "configured" }, f.authorize, actor);
    expect(f.gateway.checkout).toHaveBeenCalledTimes(2);
    const other = fixture(); await other.service.checkout(tenant, { operationId: op, planKey: "configured" }, other.authorize, actor);
    delete other.states.get(tenantKey(tenant))!.checkoutSessions.cs_Fixture;
    vi.mocked(other.gateway.retrieveCheckout).mockResolvedValue({ customerId: "cus_Fixture", operationId: op, tenant: { type: "partner", id: 999 }, priceId: "price_Configured", subscriptionId: "sub_Fixture", paymentStatus: "paid", status: "complete" });
    await expect(other.service.processEvent(other.event("evt_Foreign"))).rejects.toMatchObject({ code: "billing.checkout_binding_unverified" });
    expect(other.states.get(tenantKey(tenant))!.events.evt_Foreign).toBeUndefined();
  });
  it("rejects mode/customer substitution and rolls back event receipts on failure", async () => {
    const f = fixture(); await f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor);
    await expect(f.service.processEvent({ ...f.event("evt_Live"), livemode: true })).rejects.toMatchObject({ code: "billing.mode_mismatch" });
    vi.mocked(f.gateway.retrieveSubscription).mockResolvedValue({ id: "sub_Fixture", customerId: "cus_Foreign", status: "active", priceIds: ["price_Configured"], cancelAtPeriodEnd: false, observedAt: "2026-10-07T10:00:00Z" });
    await expect(f.service.processEvent(f.event("evt_Substitute"))).rejects.toMatchObject({ code: "billing.subscription_mismatch" });
    expect(f.states.get(tenantKey(tenant))!.subscription).toBeNull();
  });
  it("rechecks revoked authority before replay/portal and stops uncertain attempts beyond retention", async () => {
    const f = fixture(); await f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor);
    f.authorize.mockRejectedValue(Error("membership revoked"));
    await expect(f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor)).rejects.toThrow("membership revoked");
    await expect(f.service.portal(tenant, { operationId: op }, f.authorize, actor)).rejects.toThrow("membership revoked");
    expect(f.gateway.portal).not.toHaveBeenCalled();
    const g = fixture(); vi.mocked(g.gateway.checkout).mockRejectedValueOnce(Error("unknown"));
    await expect(g.service.checkout(tenant, { operationId: op, planKey: "configured" }, g.authorize, actor)).rejects.toThrow();
    const later = createBillingService(config, g.store, g.gateway, () => new Date("2026-10-09T10:00:00Z"));
    await expect(later.checkout(tenant, { operationId: op, planKey: "configured" }, g.authorize, actor)).rejects.toMatchObject({ code: "billing.checkout_outcome_unknown" });
    expect(g.gateway.checkout).toHaveBeenCalledTimes(1);
  });
  it("persists inbox before acknowledging, retains failure, and resumes after restart", async () => {
    const f = fixture(); await f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor);
    expect(await f.service.acceptEvent(f.event("evt_Restart"))).toEqual({ accepted: true, subscriptionUpdatePending: true });
    expect(f.gateway.retrieveSubscription).not.toHaveBeenCalled();
    vi.mocked(f.gateway.retrieveSubscription).mockRejectedValueOnce(Error("Stripe unavailable"));
    await expect(f.service.processEvent(f.event("evt_Restart"))).rejects.toThrow();
    expect((await f.store.pendingEvents(20))[0]?.id).toBe("evt_Restart");
    const restarted = createBillingService(config, f.store, f.gateway);
    await restarted.processEvent((await f.store.pendingEvents(20))[0]!);
    expect(await f.store.pendingEvents(20)).toEqual([]);
    expect(f.states.get(tenantKey(tenant))!.events.evt_Restart).toBeDefined();
  });
  it("defers twenty poison events so a later healthy event remains runnable without dropping failures", async () => {
    const f = fixture(); await f.service.checkout(tenant, { operationId: op, planKey: "configured" }, f.authorize, actor);
    for (let n=0;n<21;n++) await f.service.acceptEvent(f.event(`evt_${String(n).padStart(2,"0")}`));
    const first = await f.store.pendingEvents(20); expect(first).toHaveLength(20);
    for (const event of first) await f.service.deferEvent(event);
    expect((await f.store.pendingEvents(20)).map(e => e.id)).toEqual(["evt_20"]);
    expect(Object.keys(f.states.get(tenantKey(tenant))!.inbox)).toHaveLength(21);
    expect(f.states.get(tenantKey(tenant))!.inbox.evt_00?.attempts).toBe(1);
  });
});
