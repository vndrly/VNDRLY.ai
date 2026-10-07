import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { createBillingRepository } from "./stripe-billing-repository";

describe("private tenant billing transaction", () => {
  const query = vi.fn(); const release = vi.fn();
  const connection = { connect: vi.fn(async () => ({ query, release })), query };
  beforeEach(() => { query.mockReset(); release.mockReset(); query.mockResolvedValue({ rows: [] }); });
  it("locks, checks customer uniqueness across tenant types, and commits narrow owner state", async () => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT stripe_billing_state FROM vendors WHERE id") ? [{ stripe_billing_state: null }] : [] }));
    const repository = createBillingRepository("test", connection as never);
    await repository.withTenant({ type: "vendor", id: 42 }, async state => { state.customerId = "cus_fixture"; });
    expect(query.mock.calls.map(c => c[0])).toContain("SELECT pg_advisory_xact_lock(923617041)");
    expect(query).toHaveBeenCalledWith("SELECT stripe_billing_state FROM vendors WHERE id=$1 FOR UPDATE", [42]);
    expect(query.mock.calls.some(c => c[0].startsWith("UPDATE vendors SET stripe_billing_state=$2::jsonb WHERE id=$1") && c[1][0] === 42)).toBe(true);
    expect(query).toHaveBeenCalledWith("COMMIT"); expect(release).toHaveBeenCalled();
  });
  it("rolls back a foreign customer binding or malformed state without overwriting it", async () => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT stripe_billing_state") ? [{ stripe_billing_state: null }] : sql.includes("UNION ALL") ? [{ type: "partner", id: 999 }] : [] }));
    const repository = createBillingRepository("test", connection as never);
    await expect(repository.withTenant({ type: "vendor", id: 42 }, async state => { state.customerId = "cus_foreign"; })).rejects.toMatchObject({ code: "billing.customer_binding_conflict" });
    expect(query).toHaveBeenCalledWith("ROLLBACK"); expect(query.mock.calls.some(c => c[0].startsWith("UPDATE"))).toBe(false);
    query.mockReset(); query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT stripe_billing_state") ? [{ stripe_billing_state: "corrupt" }] : [] }));
    await expect(repository.withTenant({ type: "vendor", id: 42 }, async () => undefined)).rejects.toThrow();
    expect(query.mock.calls.some(c => c[0].startsWith("UPDATE"))).toBe(false);
  });
});
