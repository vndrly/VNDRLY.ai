import { expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { createDatabaseOperationsDisplayCommands, displayCommandActor } from "./operations-display-command-repository";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const version = new Date("2026-10-07T10:00:00.123Z");
const session = { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin", activeMembershipId: 12, sv: 1 };
const request = { operationId: id(3), displayId: id(1), expectedUpdatedAt: version.toISOString(), reason: "Show authorized site", action: "route", monitorName: "Left", view: "gate_log", siteLocationId: 392 };
function fixture() {
  const rows = { user: [{ role: "vendor" }], member: [{ role: "admin" }], device: [{ id: id(2) }], site: [{ id: 392, partner_id: 8 }], relationship: [{ id: 10 }], assignment: [{ id: 11 }], gate: [{ id: 11 }], meeting: [{ id: id(20) }] };
  let prior: Record<string, unknown> | null = null;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT * FROM operations_displays")) return { rows: [{ id: id(1), owner_org_type: "vendor", owner_org_id: 4, name: "Office", registered_by_user_id: 17, registered_companion_device_id: id(2), site_allowlist: [392], view_allowlist: ["gate_log", "meeting_room"], privacy_mode: true, token_hash: "PRIVATE", token_expires_at: version, revoked_at: null, revoked_by_user_id: null, created_at: version, updated_at: version }] };
    if (sql.startsWith("SELECT * FROM operations_display_outputs")) return { rows: [{ id: id(10), display_id: id(1), name: "Left", current_view: null, current_site_location_id: null, current_meeting_occurrence_id: null, updated_at: version }] };
    if (sql.startsWith("SELECT * FROM work_hub_client_operations")) return { rows: prior ? [prior] : [] };
    if (sql.startsWith("SELECT role FROM users")) return { rows: rows.user };
    if (sql.startsWith("SELECT role FROM user_org_memberships")) return { rows: rows.member };
    if (sql.startsWith("SELECT id FROM work_hub_devices")) return { rows: rows.device };
    if (sql.startsWith("SELECT id,partner_id FROM site_locations")) return { rows: rows.site };
    if (sql.startsWith("SELECT id FROM partner_vendor_relationships")) return { rows: rows.relationship };
    if (sql.startsWith("SELECT id FROM site_work_assignments")) return { rows: sql.includes("is_gate_contractor=true") ? rows.gate : rows.assignment };
    if (sql.startsWith("SELECT o.id FROM work_hub_meeting_occurrences")) return { rows: rows.meeting };
    if (sql.startsWith("INSERT INTO work_hub_client_operations")) prior = { owner_org_type: "vendor", owner_org_id: 4, applied_at: new Date(), result_json: JSON.parse(String(params[4])) };
    return { rows: [] };
  });
  const release = vi.fn(), client = { query, release } as unknown as PoolClient;
  const database = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
  return { query, rows, release, commands: createDatabaseOperationsDisplayCommands(session, database) };
}
it("locks exact operation/display and preserves millisecond CAS; receipt and audit commit together", async () => {
  const f = fixture(), actor = displayCommandActor(session);
  const result = await f.commands.execute(request, actor);
  expect(result).toMatchObject({ status: "applied", physicalDisplayVerified: false });
  expect(f.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
  expect(f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT * FROM operations_displays"))?.[0]).toContain("FOR UPDATE");
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO work_hub_audit_log"))).toBe(true);
  expect(f.query.mock.calls.at(-1)?.[0]).toBe("COMMIT"); expect(f.release).toHaveBeenCalledOnce();
  expect(await f.commands.readback(request, actor)).toEqual(result);
  expect(f.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO work_hub_client_operations"))).toHaveLength(1);
});
it.each(["user", "member", "device", "relationship", "assignment", "gate"] as const)("refuses current %s revocation on replay", async key => {
  const f = fixture(), actor = displayCommandActor(session); await f.commands.execute(request, actor);
  f.rows[key] = []; f.query.mockClear();
  await expect(f.commands.execute(request, actor)).rejects.toThrow();
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE ") || sql.startsWith("INSERT "))).toBe(false);
  expect(f.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
});
it("does not treat session admin labels as persisted admin authority", async () => {
  const f = fixture(); f.rows.member = [{ role: "member" }];
  await expect(f.commands.execute(request, displayCommandActor(session))).rejects.toThrow("current_admin_required");
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE "))).toBe(false);
});
it("rechecks exact same-company current meeting participation and never creates attendance", async () => {
  const f = fixture(), room = { operationId: id(4), displayId: id(1), expectedUpdatedAt: version.toISOString(), reason: "Show the saved room", action: "join_room", monitorName: "Left", meetingOccurrenceId: id(20) };
  await f.commands.execute(room, displayCommandActor(session));
  const lookup = f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT o.id"));
  expect(lookup?.[0]).toContain("p.removed_at IS NULL"); expect(lookup?.[1]).toEqual([id(20), 17, "vendor", 4]);
  expect(f.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO work_hub_meeting_attendance"))).toBe(false);
  f.rows.meeting = []; await expect(f.commands.readback(room, displayCommandActor(session))).rejects.toThrow("room_not_allowed");
});
