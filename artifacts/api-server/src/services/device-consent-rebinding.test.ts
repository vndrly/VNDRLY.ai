import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { connect: async () => ({ query: m.query, release: m.release }) } }));
import { rebindOwnDeviceConsent, revokeOwnDeviceConsent } from "./device-consent-rebinding";
const session = { userId: 7, vendorId: 12, role: "field_employee", sv: 1 };
const old = "10000000-0000-4000-8000-000000000001", next = "20000000-0000-4000-8000-000000000002";
const acceptedAt = new Date("2026-10-18T07:14:50.878Z");
let source: any, target: any, owned: boolean;
beforeEach(() => {
  vi.clearAllMocks(); owned = true; source = { id: 5, accepted_at: acceptedAt, revoked_at: null }; target = null;
  m.query.mockImplementation(async (sql: string, args: any[] = []) => {
    if (sql.includes("FROM users")) return { rows: [{ session_version: 1, suspended_at: null, must_change_password: false }] };
    if (sql.includes("FROM user_org_memberships")) return { rows: [{ id: 4 }] };
    if (sql.includes("FROM work_hub_devices")) return { rows: owned ? [{ id: next }] : [] };
    if (sql.includes("FROM location_consents")) return { rows: args[1] === old ? (source ? [source] : []) : (target ? [target] : []) };
    return { rows: [] };
  });
});
it("inherits only the current user's active consent while retaining the original agreement and acceptance", async () => {
  expect(await rebindOwnDeviceConsent(session, old, next)).toEqual({ inherited: true });
  const insert = m.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO location_consents"));
  expect(insert?.[1]).toEqual([7, next, old, acceptedAt]);
  expect(m.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE location_consents"))).toBe(false);
});
it("does not inherit another person's or revoked consent", async () => {
  source = null; expect(await rebindOwnDeviceConsent(session, old, next)).toEqual({ inherited: false });
  source = { revoked_at: new Date(), accepted_at: acceptedAt };
  expect(await rebindOwnDeviceConsent(session, old, next)).toEqual({ inherited: false });
  expect(m.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE location_consents"))).toBe(false);
});
it("requires a current user-owned registration in the active company", async () => {
  owned = false; await expect(rebindOwnDeviceConsent(session, old, next)).rejects.toMatchObject({ status: 403 });
  const ownership = m.query.mock.calls.find(([sql]) => sql.includes("FROM work_hub_devices"));
  expect(ownership?.[1]).toEqual([next, 7, "vendor", 12]);
  expect(m.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE location_consents"))).toBe(false);
});
it("never reactivates a revoked target consent", async () => {
  target = { revoked_at: new Date() };
  await expect(rebindOwnDeviceConsent(session, old, next)).rejects.toMatchObject({ status: 403 });
  expect(m.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE location_consents"))).toBe(false);
});

it("serializes device revocation with enrollment and revokes the physical consent and all its account aliases", async () => {
  await revokeOwnDeviceConsent(session, old);
  const lock = m.query.mock.calls.findIndex(([sql]) => sql.includes("pg_advisory_xact_lock"));
  const revoke = m.query.mock.calls.findIndex(([sql]) => sql.startsWith("UPDATE location_consents"));
  expect(lock).toBeGreaterThan(-1); expect(revoke).toBeGreaterThan(lock);
  expect(m.query.mock.calls[revoke][0]).toContain("original_device_id=$2");
  expect(m.query.mock.calls[revoke][1]).toEqual([7, old]);
});

it("locks every existing native context before revoke-all can update complete native state", async () => {
  const query = m.query.getMockImplementation()!;
  m.query.mockImplementation(async (sql: string, args: any[] = []) => sql.startsWith("SELECT owner_org_id") ? { rows: [{ owner_org_id: 12 }, { owner_org_id: 19 }] } : query(sql, args));
  await revokeOwnDeviceConsent(session, null);
  const calls = m.query.mock.calls;
  expect(calls.find(([sql]) => sql.startsWith("SELECT owner_org_id"))?.[0]).toContain("ORDER BY owner_org_id");
  const locks = calls.flatMap(([sql, args], index) => sql.includes("hashtextextended") ? [{ args, index }] : []);
  expect(locks.map(value => value.args)).toEqual([["native:12:7"], ["native:19:7"]]);
  expect(calls.findIndex(([sql]) => sql.startsWith("UPDATE location_consents"))).toBeGreaterThan(locks[1]!.index);
});
