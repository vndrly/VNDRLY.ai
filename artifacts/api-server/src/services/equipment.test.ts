import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
vi.mock("@workspace/db", () => ({ pool: {} }));
vi.mock("../lib/objectStore", () => ({ getObjectStore: () => ({ getObject: vi.fn() }) }));
import { createEquipmentService } from "./equipment";
import { equipmentProfile } from "./equipment-model";

const session = { userId: 7, vendorId: 19, activeMembershipId: 9, sv: 1, role: "vendor" };
function fixture(role = "admin", scope: { membership?: boolean; grants?: string[]; people?: { id: number; label: string }[] } = {}) {
  const id = randomUUID(), now = new Date("2026-10-31T16:00:00Z");
  let row = { id, name: "Trailer", category: "trailer", legal_owner_name: "Test", responsible_org_type: "vendor", responsible_org_id: 19, status: "available", version: 1, current_holder_user_id: null as number | null, equipment_profile: { ...equipmentProfile(null, "trailer"), trackOnMap: true } as Record<string, unknown>, manufacturer: null, model: null };
  const events: { asset_id: string; command_fingerprint: string; operation_id: string }[] = [], writes: string[] = [];
  const holds: { id: string; reason: string }[] = [];
  const links: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.startsWith("SELECT role FROM users")) return { rows: [{ role: "vendor" }] };
    if (sql.includes("SELECT m.role,vp.vendor_role")) return { rows: scope.membership === false ? [] : [{ role, vendor_role: role === "admin" ? "office" : "field" }] };
    if (sql.includes("SELECT g.role")) return { rows: (scope.grants ?? []).map(role => ({ role })) };
    if (sql.startsWith("SELECT * FROM assets")) return { rows: [structuredClone(row)] };
    if (sql.startsWith("SELECT asset_id,command_fingerprint")) return { rows: events.filter(event => event.operation_id === params[0]) };
    if (sql.startsWith("SELECT * FROM asset_category_policies")) return { rows: [] };
    if (sql.startsWith("SELECT id,reason FROM asset_holds") || sql.startsWith("SELECT id FROM asset_holds")) return { rows: holds };
    if (sql.startsWith("SELECT kind,display_value")) return { rows: [] };
    if (sql.startsWith("INSERT INTO asset_custody_events")) { writes.push(sql); const custody = sql.includes("from_holder_user_id"); events.push({ asset_id: params[0] as string, operation_id: params[custody ? 7 : 3] as string, command_fingerprint: params[custody ? 9 : 5] as string }); return { rows: [{ id: randomUUID() }] }; }
    if (sql.startsWith("UPDATE assets SET current_holder_user_id")) { writes.push(sql); row = { ...row, current_holder_user_id: params[2] as number | null, status: params[6] as string, version: row.version + 1 }; return { rows: [structuredClone(row)] }; }
    if (sql.startsWith("UPDATE asset_custody_events SET command_fingerprint")) { events.find(event => event.operation_id === params[0])!.command_fingerprint = params[1] as string; return { rows: [] }; }
    if (sql.startsWith("INSERT INTO asset_condition_evidence")) { writes.push(sql); return { rows: [] }; }
    if (sql.startsWith("INSERT INTO asset_attachment_links")) { writes.push(sql); links.push(params); return { rows: [] }; }
    if (sql.startsWith("UPDATE assets SET equipment_profile")) { writes.push(sql); row = { ...row, equipment_profile: JSON.parse(params[1] as string), version: params[2] as number }; return { rows: [] }; }
    if (sql.startsWith("UPDATE assets SET name")) { writes.push(sql); row.name = (params[1] as string) ?? row.name; return { rows: [] }; }
    if (sql.startsWith("SELECT u.id FROM users")) return { rows: [7, 8].includes(params[0] as number) ? [{ id: params[0] }] : [] };
    if (sql.startsWith("SELECT t.id FROM tickets")) return { rows: [] };
    if (sql.startsWith("SELECT id FROM work_hub_tasks")) return { rows: [] };
    if (sql.startsWith("SELECT display_name")) return { rows: [{ display_name: "Employee" }] };
    if (sql.startsWith("SELECT audit.tool_output")) return { rows: [] };
    if (sql.startsWith("SELECT u.id,COALESCE")) return { rows: (scope.people ?? [{ id: 7, label: "Employee" }]).filter(person => params[2] === true || person.id === params[3]) };
    if (sql.startsWith("SELECT t.id,'Ticket #'") || sql.startsWith("SELECT id,title AS label") || sql.startsWith("SELECT site.id,site.name AS label")) return { rows: [] };
    throw new Error(`Unexpected SQL ${sql}`);
  });
  const client = { query, release: vi.fn() }, database = { connect: async () => client as unknown as PoolClient } as Pick<Pool, "connect">;
  return { id, database, query, writes, events, holds, links, service: createEquipmentService(database, () => now), row: () => row };
}
describe("shared equipment atomic operations", () => {
  it("requires both the current sponsor membership and fresh grants for managed gatekeepers", async () => {
    const managedSession = { ...session, role: "field_employee", managedSubcontractor: { siteGrants: [{ siteId: 45, role: "gatekeeper" as const }] } };
    const active = fixture("field_employee", { grants: ["gatekeeper"] });
    expect((await active.service.detail(managedSession, active.id)).capabilities).toMatchObject({ canManage: false, canCheckout: true });
    const revoked = fixture("field_employee");
    await expect(revoked.service.list(managedSession)).rejects.toMatchObject({ code: "equipment.active_sponsorship_required" });
    expect(revoked.writes).toHaveLength(0);
    const wrongMembership = fixture("field_employee", { membership: false, grants: ["gatekeeper"] });
    await expect(wrongMembership.service.list(managedSession)).rejects.toMatchObject({ code: "equipment.current_membership_required" });
    expect(wrongMembership.writes).toHaveLength(0);
  });
  it("offers scoped sponsored workers to office assignment while limiting field choices to self", async () => {
    const people = [{ id: 7, label: "Employee" }, { id: 8, label: "Sponsored worker" }];
    const office = fixture("admin", { people });
    expect((await office.service.options(session)).people).toEqual(people);
    const peopleSql = office.query.mock.calls.find(([sql]) => sql.startsWith("SELECT u.id,COALESCE"))!;
    expect(peopleSql[0]).toContain("sp.sponsor_vendor_id=$2 AND sp.status='active'");
    expect(peopleSql[0]).toContain("g.sponsorship_id=sp.id AND g.status='active'");
    expect(peopleSql[0]).toContain("sponsor.status='active'");
    expect(peopleSql[1]).toEqual(["vendor", 19, true, 7]);
    const field = fixture("field_employee", { people });
    expect((await field.service.options(session)).people).toEqual([people[0]]);
  });
  it("lets office check in existing custody after the former holder loses sponsorship", async () => {
    const f = fixture(); f.row().current_holder_user_id = 888; f.row().status = "checked_out";
    const result = await f.service.operate(session, f.id, { operationId: randomUUID(), expectedVersion: 1, action: "return" });
    expect(result).toMatchObject({ holderUserId: null, status: "available", profile: { assignedUserId: null } });
    expect(result.profile.history.at(-1)).toMatchObject({ action: "return", assignedUserId: 888 });
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("SELECT u.id FROM users"))).toBe(false);
  });
  it("checks equipment back in while retaining the prior ticket, task, connection and holder in return history", async () => {
    const f = fixture(), taskId = randomUUID(), parentAssetId = randomUUID();
    f.row().current_holder_user_id = 7; f.row().status = "checked_out";
    f.row().equipment_profile = { ...f.row().equipment_profile, assignedUserId: 7, ticketId: 45, taskId, parentAssetId };
    const result = await f.service.operate(session, f.id, { operationId: randomUUID(), expectedVersion: 1, action: "return" });
    expect(result.profile).toMatchObject({ assignedUserId: null, ticketId: null, taskId: null, parentAssetId: null });
    expect(result.profile.history.at(-1)).toMatchObject({ action: "return", assignedUserId: 7, ticketId: 45, taskId, parentAssetId });
    expect(f.links).toEqual([[f.id, "ticket", "45", 7], [f.id, "task", taskId, 7]]);
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
  });
  it("offers checkout for an unheld legacy active inventory record without changing its status on read", async () => {
    const f = fixture(); f.row().status = "active";
    expect((await f.service.detail(session, f.id)).capabilities.canCheckout).toBe(true);
    expect(f.row().status).toBe("active");
    expect(f.writes).toHaveLength(0);
    f.holds.push({ id: randomUUID(), reason: "Inspection" });
    expect((await f.service.detail(session, f.id)).capabilities.canCheckout).toBe(false);
    expect(f.writes).toHaveLength(0);
  });
  it("records the office actor separately when checking legacy active equipment out to another authorized person", async () => {
    const f = fixture(); f.row().status = "active";
    const result = await f.service.operate(session, f.id, { operationId: randomUUID(), expectedVersion: 1, action: "checkout", assignedUserId: 8 });
    expect(result).toMatchObject({ id: f.id, holderUserId: 8, status: "checked_out", profile: { assignedUserId: 8 } });
    const audit = f.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO asset_custody_events") && sql.includes("from_holder_user_id"));
    expect(audit?.[1]?.[3]).toBe(8);
    expect(audit?.[1]?.[6]).toBe(7);
    const field = fixture("field_employee"); field.row().status = "active";
    await expect(field.service.operate(session, field.id, { operationId: randomUUID(), expectedVersion: 1, action: "checkout", assignedUserId: 8 })).rejects.toMatchObject({ code: "equipment.assigned_to_another_person" });
    expect(field.writes).toHaveLength(0);
  });
  it("replays exactly once and rejects operation reuse or stale versions before writes", async () => {
    const f = fixture(), operationId = randomUUID(), body = { operationId, expectedVersion: 1, action: "location", activity: "in_yard", location: { latitude: 35, longitude: -97, observedAt: "2026-10-31T15:59:00Z", source: "manual" } };
    const first = await f.service.operate(session, f.id, body);
    expect(first).toMatchObject({ id: f.id, version: 2, profile: { activity: "in_yard" }, location: { source: "manual", freshness: "last_known" } });
    expect((await f.service.operate(session, f.id, body)).version).toBe(2);
    expect(f.events).toHaveLength(1);
    await expect(f.service.operate(session, f.id, { ...body, activity: "working" })).rejects.toMatchObject({ code: "equipment.operation_reused" });
    await expect(f.service.operate(session, f.id, { ...body, operationId: randomUUID() })).rejects.toMatchObject({ code: "equipment.version_conflict" });
    expect(f.events).toHaveLength(1);
  });
  it("rejects unassigned field staff changing another person's equipment", async () => {
    const f = fixture("field_employee");
    await expect(f.service.operate(session, f.id, { operationId: randomUUID(), expectedVersion: 1, action: "location", activity: "working" })).rejects.toMatchObject({ code: "equipment.operator_required" });
    await expect(f.service.update(session, f.id, { operationId: randomUUID(), expectedVersion: 1, trackOnMap: true })).rejects.toMatchObject({ code: "equipment.manager_required" });
    expect(f.writes).toHaveLength(0);
  });
  it("validates person/ticket/task tenant relations before any assignment write", async () => {
    const f = fixture(), base = { operationId: randomUUID(), expectedVersion: 1, action: "assign" };
    await expect(f.service.operate(session, f.id, { ...base, assignedUserId: 888 })).rejects.toMatchObject({ code: "equipment.person_not_found" });
    await expect(f.service.operate(session, f.id, { ...base, ticketId: 99 })).rejects.toMatchObject({ code: "equipment.ticket_not_found" });
    await expect(f.service.operate(session, f.id, { ...base, taskId: randomUUID() })).rejects.toMatchObject({ code: "equipment.task_not_found" });
    expect(f.writes).toHaveLength(0);
  });
  it("does not let a client invent a device GPS observation", async () => {
    const f = fixture();
    await expect(f.service.operate(session, f.id, { operationId: randomUUID(), expectedVersion: 1, action: "location", location: { latitude: 35, longitude: -97, observedAt: "2026-10-31T16:00:00Z", source: "device" } })).rejects.toMatchObject({ code: "equipment.device_observation_required" });
    expect(f.writes).toHaveLength(0);
  });
  it("labels an explicit fresh self phone capture without claiming equipment GPS", async () => {
    const f = fixture("field_employee"); f.row().current_holder_user_id = 7;
    const capture = { operationId: randomUUID(), expectedVersion: 1, action: "location", location: { latitude: 35, longitude: -97, observedAt: "2026-10-31T16:00:00Z", source: "device" } };
    const result = await f.service.operate(session, f.id, capture);
    expect(result.location).toMatchObject({ source: "phone_report", freshness: "fresh", label: "User-reported phone position; equipment presence unverified" });
    expect(result.profile.location?.reportedByUserId).toBe(7);
    const stale = fixture("field_employee"); stale.row().current_holder_user_id = 7;
    await expect(stale.service.operate(session, stale.id, { ...capture, location: { ...capture.location, observedAt: "2026-10-31T15:55:00Z" } })).rejects.toMatchObject({ code: "equipment.device_observation_required" });
    expect(stale.writes).toHaveLength(0);
  });
});
