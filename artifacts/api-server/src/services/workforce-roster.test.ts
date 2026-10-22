import { beforeEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { summarizeWorkday } from "@workspace/api-zod";
import { readWorkforceRoster, workforceOnCall } from "./workforce-roster";

const access = vi.hoisted(() => ({ supervisor: true, profiles: false, current: true }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: vi.fn(async session => { if (!access.current) throw Error("revoked"); return session; }) }));
vi.mock("../lib/vendor-people-management", () => ({ canManageVendorPeople: vi.fn(async () => access.profiles) }));
vi.mock("./gate-change-over", () => ({ ChangeOverError: class extends Error {}, requireChangeOverAccess: vi.fn(async () => ({ supervisor: access.supervisor })) }));
const at = new Date("2026-10-22T14:00:00Z"), owner = { type: "vendor", id: 4 };
const session = { userId: 17, role: "field_employee", vendorId: 4, vendorRole: "gate_supervisor", activeMembershipId: 8, membershipRole: "field_employee", sv: 2 };
const id = "00000000-0000-4000-8000-000000000001";
function clock(ended = false) {
  const event = { id, shiftId: id, owner, workerUserId: 18, kind: "start_shift", capturedAt: at.toISOString(), receivedAt: at.toISOString(), source: "worker_report" };
  const history = ended ? [event, { ...event, id: "00000000-0000-4000-8000-000000000002", kind: "end_shift", capturedAt: "2026-10-22T15:00:00.000Z", receivedAt: "2026-10-22T15:00:00.000Z" }] : [event];
  return { id, version: history.length, owner, workerUserId: 18, timezone: "America/Chicago", summary: summarizeWorkday(history as never) };
}
function fixture(rows: unknown[]) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({ rows: sql.startsWith("SELECT p.id AS workforce_access") ? [{ workforce_access: 1 }] : sql.startsWith("SELECT DISTINCT s.id") ? [{ id: 5 }] : sql.startsWith("SELECT DISTINCT ON(p.user_id)") ? rows : [] }));
  const database = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pick<Pool, "connect">;
  return { database, query };
}
beforeEach(() => { access.supervisor = true; access.profiles = false; access.current = true; });
it("keeps on-call independent of duty and retains absent availability as unknown", () => {
  expect(workforceOnCall(null, at)).toBe("unknown");
  expect(workforceOnCall({ duty: { active: true } }, at)).toBe("unknown");
  expect(workforceOnCall({ onCallActive: false, duty: { active: true } }, at)).toBe("inactive");
  expect(workforceOnCall({ onCallActive: true, duty: { active: false } }, at)).toBe("active");
  expect(workforceOnCall({ onCallWindows: [{ startsAt: "2026-10-22T13:00:00Z", endsAt: "2026-10-22T15:00:00Z", consent: true }] }, at)).toBe("active");
  expect(workforceOnCall({ onCallWindows: [{ startsAt: at.toISOString(), endsAt: at.toISOString(), consent: true }] }, at)).toBe("unknown");
  expect(workforceOnCall({ onCallActive: "false" }, at)).toBe("unknown");
  expect(workforceOnCall({ onCallWindows: [] }, at)).toBe("inactive");
});
it("projects the canonical paid clock separately from native duty without private fields", async () => {
  const f = fixture([{ id: 30, user_id: 18, first_name: "Gate", last_name: "Worker", native_operations: { duty: { active: false }, onCallActive: true, location: { latitude: 5 } }, workday: clock(), assignment: "North Gate", email: "private@example.com", phone: "555" }]);
  const roster = await readWorkforceRoster(session, f.database, at);
  expect(roster).toMatchObject({ scope: "managed_sites", canManageOffers: true, employees: [{ onCall: "active", onShift: true, shiftStartedAt: at.toISOString(), profileHref: null, canMessage: true }] });
  expect(JSON.stringify(roster)).not.toMatch(/private@example|latitude|phone/);
  const selection = f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT DISTINCT ON(p.user_id)"))!;
  expect(selection[0]).toContain("p.vendor_id=$1");
  expect(selection[0]).toContain("a.site_location_id=ANY($3::int[])");
  expect(selection[0]).toContain("r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor')");
  expect(selection[0]).not.toContain("LIMIT 50");
  expect(selection[1]).toEqual([4, false, [5], 17, at]);
});
it("shows unknown without a canonical clock, ended clocks as off shift and full profiles only when authorized", async () => {
  access.profiles = true;
  const person = { id: 30, user_id: 18, first_name: "Gate", last_name: "Worker", native_operations: { duty: { active: true } }, assignment: null };
  expect((await readWorkforceRoster({ ...session, membershipRole: "admin" }, fixture([{ ...person, workday: clock(true) }]).database, at)).employees[0]).toMatchObject({ onShift: false, shiftStartedAt: null, profileHref: "/field-employees/30", onCall: "unknown" });
  expect((await readWorkforceRoster(session, fixture([person]).database, at)).employees[0].onShift).toBeNull();
});
it("bounds ordinary members to self and refuses revoked sessions", async () => {
  access.supervisor = false;
  const f = fixture([]);
  expect(await readWorkforceRoster({ ...session, vendorRole: "gatekeeper" }, f.database, at)).toMatchObject({ scope: "self", canManageOffers: false });
  expect(f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT DISTINCT ON(p.user_id)"))![1]).toEqual([4, false, [], 17, at]);
  access.current = false;
  await expect(readWorkforceRoster(session, f.database, at)).rejects.toThrow("revoked");
});
