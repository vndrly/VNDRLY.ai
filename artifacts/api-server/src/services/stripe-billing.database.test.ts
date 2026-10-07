import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { createBillingService, type BillingGateway } from "./stripe-billing";

const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);

describe.skipIf(!isolated)("private organization subscription PostgreSQL persistence", () => {
  let pool: Pool;
  let repositoryModule: typeof import("./stripe-billing-repository");
  let vendorId: number;
  let partnerId: number;
  beforeAll(async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const pg = (await import("pg")).default;
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const target = new URL(process.env.DATABASE_URL!);
    const identity = (await pool.query("SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port")).rows[0];
    expect(identity).toEqual({ database: process.env.VNDRLY_FRESH_TEST_DB_NAME, address: "127.0.0.1", port: Number(target.port) });
    await pool.query("ALTER TABLE vendors ADD COLUMN IF NOT EXISTS stripe_billing_state jsonb");
    await pool.query("ALTER TABLE partners ADD COLUMN IF NOT EXISTS stripe_billing_state jsonb");
    repositoryModule = await import("./stripe-billing-repository");
  });
  afterAll(async () => { await pool?.end(); });
  beforeEach(async () => {
    const marker = `isolated-billing-${randomUUID()}`;
    vendorId = (await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Synthetic billing fixture',$2) RETURNING id", [marker, `${marker}@example.invalid`])).rows[0].id;
    partnerId = (await pool.query("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Synthetic billing fixture',$2) RETURNING id", [marker, `${marker}@example.invalid`])).rows[0].id;
  });
  it("serializes duplicate webhook state+receipt and preserves failed reconciliation for restart", async () => {
    const store = repositoryModule.createBillingRepository("test", pool);
    const tenant = { type: "vendor", id: vendorId } as const;
    const customerId = `cus_${randomUUID()}`;
    const gateway: BillingGateway = {
      createCustomer: vi.fn(), checkout: vi.fn(), portal: vi.fn(), retrieveCheckout: vi.fn(),
      retrieveSubscription: vi.fn(async (id: string) => ({ id, customerId, status: "active" as const, priceIds: ["price_Fixture"], cancelAtPeriodEnd: false, observedAt: new Date().toISOString() })),
    };
    await store.withTenant(tenant, async state => { state.customerId = customerId; state.checkoutSessions.cs_fixture = "price_Fixture"; });
    const config = { enabled: true, mode: "test" as const, origin: "https://vndrly.ai", plans: [{ key: "fixture", label: "Fixture", priceId: "price_Fixture" }] };
    const service = createBillingService(config, store, gateway);
    const event = { id: `evt_${randomUUID()}`, type: "checkout.session.completed", livemode: false, object: { customerId, subscriptionId: "sub_fixture", sessionId: "cs_fixture", paymentStatus: "paid" } };
    await Promise.all([service.acceptEvent(event), service.acceptEvent(event)]);
    vi.mocked(gateway.retrieveSubscription).mockRejectedValueOnce(Error("temporary external failure"));
    await expect(service.processEvent(event)).rejects.toThrow();
    await store.withTenant(tenant, async state => { expect(state.inbox[event.id]?.event).toEqual(event); expect(state.events[event.id]).toBeUndefined(); expect(state.subscription).toBeNull(); });
    const restarted = createBillingService(config, repositoryModule.createBillingRepository("test", pool), gateway);
    await Promise.all([restarted.processEvent(event), restarted.processEvent(event)]);
    expect(gateway.retrieveSubscription).toHaveBeenCalledTimes(2); // one failure + one accepted retrieval
    await store.withTenant(tenant, async state => { expect(state.inbox[event.id]).toBeUndefined(); expect(state.events[event.id]).toBeDefined(); expect(state.subscription?.status).toBe("active"); });
  });
  it("prevents cross-tenant/customer reuse and rolls back malformed state without destructive cleanup", async () => {
    const store = repositoryModule.createBillingRepository("test", pool);
    const customerId = `cus_${randomUUID()}`;
    await store.withTenant({ type: "vendor", id: vendorId }, async state => { state.customerId = customerId; });
    await expect(store.withTenant({ type: "partner", id: partnerId }, async state => { state.customerId = customerId; })).rejects.toMatchObject({ code: "billing.customer_binding_conflict" });
    await store.withTenant({ type: "partner", id: partnerId }, async state => { expect(state.customerId).toBeNull(); });
    const sentinel = { syntheticMalformed: "preserve" };
    await pool.query("UPDATE partners SET stripe_billing_state=$2::jsonb WHERE id=$1", [partnerId, JSON.stringify(sentinel)]);
    await expect(store.withTenant({ type: "partner", id: partnerId }, async () => undefined)).rejects.toThrow();
    expect((await pool.query("SELECT stripe_billing_state FROM partners WHERE id=$1", [partnerId])).rows[0].stripe_billing_state).toEqual(sentinel);
  });
  it("moves twenty failing events out of the due batch so a different tenant reconciles", async () => {
    const store = repositoryModule.createBillingRepository("test", pool);
    const badCustomer = `cus_bad_${randomUUID()}`, goodCustomer = `cus_good_${randomUUID()}`;
    for (const [tenant, customerId, id] of [[{type:"vendor",id:vendorId},badCustomer,"sub_bad"],[{type:"partner",id:partnerId},goodCustomer,"sub_good"]] as const) {
      await store.withTenant(tenant, async state => { state.customerId=customerId; state.subscription={id,customerId,status:"active",priceIds:["price_Fixture"],cancelAtPeriodEnd:false,observedAt:new Date().toISOString()}; });
    }
    const gateway: BillingGateway = { createCustomer: vi.fn(), checkout: vi.fn(), portal: vi.fn(), retrieveCheckout: vi.fn(), retrieveSubscription: vi.fn(async (id:string) => { if(id==="sub_bad")throw Error("provider refusal");return {id,customerId:goodCustomer,status:"active" as const,priceIds:["price_Fixture"],cancelAtPeriodEnd:false,observedAt:new Date().toISOString()}; }) };
    const service=createBillingService({enabled:true,mode:"test",origin:"https://vndrly.ai",plans:[{key:"fixture",label:"Fixture",priceId:"price_Fixture"}]},store,gateway);
    for(let n=0;n<20;n++) await service.acceptEvent({id:`evt_bad_${randomUUID()}`,type:"customer.subscription.updated",livemode:false,object:{customerId:badCustomer,subscriptionId:"sub_bad"}});
    const good={id:`evt_good_${randomUUID()}`,type:"customer.subscription.updated",livemode:false,object:{customerId:goodCustomer,subscriptionId:"sub_good"}};
    await service.acceptEvent(good);
    const batch=await store.pendingEvents(20);expect(batch).toHaveLength(20);
    for(const event of batch){try{await service.processEvent(event);}catch{await service.deferEvent(event);}}
    const next=await store.pendingEvents(20);expect(next.map(e=>e.id)).toContain(good.id);
    await service.processEvent(good);
    await store.withTenant({type:"partner",id:partnerId},async state=>{expect(state.events[good.id]).toBeDefined();});
    await store.withTenant({type:"vendor",id:vendorId},async state=>{expect(Object.keys(state.inbox)).toHaveLength(20);});
  });
});
