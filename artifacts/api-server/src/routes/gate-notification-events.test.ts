import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware } from "../test-utils/route-app";

const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, notifications: [] as any[], sequence: 10, revoked: new Set<number>(), pg: vi.fn(), transactionOpen: false, handovers: [] as any[], coverage: null as any }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {} }));
vi.mock("drizzle-orm", async importOriginal => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const val = (c: any, row: any) => c?.table ? row[actual.getTableName(c.table)]?.[Object.keys(c.table).find(k => c.table[k] === c)!] : c;
  return { ...actual,
    eq: (a: any, b: any) => (r: any) => val(a, r) === val(b, r),
    ne: (a: any, b: any) => (r: any) => val(a, r) !== val(b, r),
    isNull: (a: any) => (r: any) => val(a, r) == null,
    inArray: (a: any, b: any[]) => (r: any) => b.includes(val(a, r)),
    and: (...p: any[]) => (r: any) => p.filter(Boolean).every(f => typeof f !== "function" || f(r)),
    or: (...p: any[]) => (r: any) => p.filter(Boolean).some(f => typeof f !== "function" || f(r)),
  };
});
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../../lib/db/src/schema");
  const { getTableName } = await import("drizzle-orm");
  const read = (select?: any) => {
    let table: any, predicate = (_r: any) => true, cap = Infinity;
    const joins: { table: any; on: any; left: boolean }[] = [];
    const execute = () => {
      let rows = (state.tables[getTableName(table)] ?? []).map(r => ({ [getTableName(table)]: r }));
      for (const j of joins) rows = rows.flatMap(r => {
        const matches = (state.tables[getTableName(j.table)] ?? []).map(other => ({ ...r, [getTableName(j.table)]: other })).filter(j.on);
        return matches.length || !j.left ? matches : [r];
      });
      rows = rows.filter(predicate).slice(0, cap);
      return rows.map(r => select ? Object.fromEntries(Object.entries(select).map(([key, c]: [string, any]) => [key, c?.table ? r[getTableName(c.table)]?.[Object.keys(c.table).find(k => c.table[k] === c)!] : undefined])) : r[getTableName(table)]);
    };
    const q: any = { from: (t: any) => { table = t; return q; }, where: (p: any) => { predicate = typeof p === "function" ? p : () => true; return q; }, limit: (n: number) => { cap = n; return q; },
      innerJoin: (t: any, on: any) => { joins.push({ table: t, on, left: false }); return q; },
      leftJoin: (t: any, on: any) => { joins.push({ table: t, on, left: true }); return q; },
      for: () => q, orderBy: () => q, groupBy: () => q, then: (ok: any, fail: any) => Promise.resolve().then(execute).then(ok, fail) };
    return q;
  };
  const db: any = {
    select: read,
    transaction: async (f: any) => f(db),
    execute: async () => ({ rows: [] }),
    insert: (table: any) => ({ values: (values: any) => {
      let ignore = false;
      const execute = () => {
        const name = getTableName(table), rows = state.tables[name] ??= [];
        return (Array.isArray(values) ? values : [values]).flatMap(v => {
          if (ignore && name === "work_hub_client_operations" && rows.some(r => r.operationId === v.operationId && r.userId === v.userId && r.commandKind === v.commandKind)) return [];
          const seq = ++state.sequence;
          const row = { id: name === "safety_events" ? seq : `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, version: 1, createdAt: new Date(), ...v };
          rows.push(row); return [row];
        });
      };
      const q: any = { returning: async () => execute(), onConflictDoNothing: () => { ignore = true; return q; }, then: (ok: any, fail: any) => Promise.resolve().then(execute).then(ok, fail) };
      return q;
    } }),
    update: (table: any) => ({ set: (patch: any) => ({ where: (p: any) => {
      const rows = (state.tables[getTableName(table)] ?? []).filter(r => p({ [getTableName(table)]: r }));
      rows.forEach(r => Object.assign(r, patch));
      return { returning: async () => rows, then: (ok: any) => Promise.resolve(rows).then(ok) };
    } }) }),
  };
  return { ...schema, db, pool: { query: state.pg, connect: async () => ({ query: state.pg, release: () => {} }) } };
});
vi.mock("./notifications", () => ({
  notifyUsers: async (userIds: number[], notice: any) => { if (notice.type.startsWith("gate_")) expect(state.transactionOpen).toBe(false); state.notifications.push({ userIds, ...notice }); return userIds.length; },
  findVendorUserIdsBatch: async (ids: number[]) => new Map(ids.map(id => [id, state.tables.user_org_memberships.filter(m => m.vendorId === id && m.role === "admin").map(m => m.userId)])),
  findPartnerUserIdsBatch: async () => new Map(),
}));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: async () => {} }));
vi.mock("../lib/safety-hse", () => ({ findPartnerHseUserIds: async () => [], findVendorHseUserIds: async () => [1] }));
vi.mock("../lib/safety-rate-limit", () => ({ enforceSafetyRateLimit: (_req: any, _res: any, next: any) => next() }));
vi.mock("../work-hub/queries", () => ({
  resolveChannelAccess: async (actor: any, id: string) => {
    const channel = state.tables.work_hub_channels.find(r => r.id === id);
    if (!channel || actor.vendorId !== channel.ownerOrgId || state.revoked.has(actor.userId)) throw Object.assign(new Error("revoked"), { status: 404 });
    return { channel };
  },
}));
vi.mock("../lib/notification-destination", () => ({ resolveNotificationDestination: async (actor: any, link: string) => state.revoked.has(actor.userId) ? null : link }));
vi.mock("../services/gate-alert-repository", () => ({ loadGateAlertRecipient: async (userId: number) => {
  const m = state.tables.user_org_memberships.find(r => r.userId === userId);
  if (!m) return null;
  return { gate: m.vendorRole === "gatekeeper", session: { userId, role: "vendor", vendorId: m.vendorId, vendorRole: m.vendorRole, sv: 1 } };
} }));

const channelId = "20000000-0000-4000-8000-000000000001";
const stationId = "40000000-0000-4000-8000-000000000001";
const preparationId = "50000000-0000-4000-8000-000000000001";
const shiftId = "60000000-0000-4000-8000-000000000001";
const handoffId = "70000000-0000-4000-8000-000000000001";
const cookie = buildTestCookie({ userId: 1, role: "vendor", vendorId: 11, membershipRole: "admin", sv: 1 });
const envelope = (payload: any, kind = "organization") => ({ operationId: "30000000-0000-4000-8000-000000000001", owner: { type: "vendor", id: 11 }, context: { kind, id: kind === "organization" ? 11 : 3 }, expectedVersion: null, payloadVersion: 1, payload });
let app: express.Express;
beforeEach(async () => {
  state.tables = {
    user_org_memberships: [{ id: 1, userId: 1, orgType: "vendor", vendorId: 11, role: "admin" }, { id: 2, userId: 2, orgType: "vendor", vendorId: 11, role: "member", vendorRole: "gatekeeper" }, { id: 3, userId: 3, orgType: "vendor", vendorId: 99, role: "member" }],
    work_hub_channels: [{ id: channelId, ownerOrgType: "vendor", ownerOrgId: 11, contextKind: "gate", contextId: "3" }],
    work_hub_channel_members: [{ channelId, userId: 1 }, { channelId, userId: 2 }],
    users: [{ id: 1, role: "vendor", sessionVersion: 1 }, { id: 2, role: "vendor", sessionVersion: 1 }, { id: 3, role: "vendor", sessionVersion: 1 }],
    vendor_people: [{ id: 22, userId: 2, vendorId: 11, vendorRole: "gatekeeper", isActive: true }],
    site_work_assignments: [{ id: 8, vendorId: 11, siteLocationId: 3 }],
    site_locations: [{ id: 3, partnerId: 22, name: "Gate site", isActive: true }],
    partners: [{ id: 22, name: "Site owner" }],
  };
  state.notifications = []; state.sequence = 10; state.revoked.clear();
  state.transactionOpen = false; state.handovers = []; state.coverage = null;
  const { assembleShiftSnapshot } = await import("../services/gate-change-over-snapshot");
  const snapshot = assembleShiftSnapshot([], [], "2026-09-24T08:00:00.000Z");
  state.pg.mockReset().mockImplementation(async (sql: string, values: any[] = []) => {
    let rows: any[] = [];
    if (sql === "BEGIN") state.transactionOpen = true;
    else if (sql === "COMMIT" || sql === "ROLLBACK") state.transactionOpen = false;
    else if (sql.includes("SELECT id, role, session_version")) rows = [{ id: values[0], role: "vendor", session_version: 1, display_name: "Gate worker" }];
    else if (sql.startsWith("SELECT id, name, partner_id")) rows = [{ id: 3, name: "Site", partner_id: 22 }];
    else if (sql.includes("FROM gate_stations")) rows = [{ id: stationId, site_id: 3 }];
    else if (sql.includes("FROM site_work_assignments") || sql.includes("FROM user_org_memberships")) rows = [{ id: 1 }];
    else if (sql.startsWith("SELECT vendor_role")) rows = state.revoked.has(values[0]) ? [] : [{ vendor_role: values[0] === 1 ? "gate_supervisor" : "gatekeeper" }];
    else if (sql.startsWith("SELECT s.*, u.display_name")) rows = [{ id: shiftId, operator_id: 1, station_id: stationId, preparation_id: preparationId, started_at: "2026-09-24T08:00:00.000Z" }];
    else if (sql.startsWith("SELECT * FROM gate_handovers")) rows = state.handovers.filter(row => row.id === values[0]);
    else if (sql.startsWith("SELECT * FROM gate_preparations")) rows = [{ id: preparationId, shift_id: shiftId, snapshot, created_at: new Date() }];
    else if (sql.startsWith("INSERT INTO gate_shifts")) rows = [{ id: "80000000-0000-4000-8000-000000000001" }];
    else if (sql.trimStart().startsWith("INSERT INTO gate_handovers")) { const row = { id: values[0], preparation_id: values[1], incoming_user_id: values[3] }; state.handovers.push(row); rows = [row]; }
    else if (sql.includes("SELECT") && sql.includes("FROM gate_coverage_status")) rows = state.coverage ? [state.coverage] : [];
    else if (sql.trimStart().startsWith("INSERT INTO gate_coverage_status")) { state.coverage = { station_id: values[0], mode: values[1], reason: values[3], changed_at: new Date("2026-09-24T14:00:00Z") }; rows = [state.coverage]; }
    return { rows, rowCount: rows.length };
  });
  app = express().use(express.json()).use(cookieParser());
  app.use((await import("./workHubOperations")).default, (await import("./workHubChannels")).default, (await import("./safety")).default);
  attachTestErrorMiddleware(app);
});
const post = (path: string, body: any) => request(app).post(path).set("Cookie", cookie).send(body);
describe("real Work Hub notification producers", () => {
  it.each([
    ["tasks", { title: "Gate task", assigneeUserId: 2 }, "work_hub_task_assigned", "/work-hub/tasks/"],
    ["shifts", { title: "Gate shift", timezone: "America/Chicago", startsAt: "2026-09-25T12:00:00Z", endsAt: "2026-09-25T20:00:00Z", assigneeUserIds: [2] }, "work_hub_shift_assigned", "/work-hub/calendar?shift="],
  ])("creates one exact %s notice and suppresses command replay", async (path, payload, type, prefix) => {
    const body = envelope(payload);
    const created = await post(`/work-hub/${path}`, body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(state.notifications).toEqual([expect.objectContaining({ userIds: [2], type, link: prefix + created.body.resource.id })]);
    if (path === "shifts") expect(state.notifications[0].category).toBe("work_hub_schedule");
    expect((await post(`/work-hub/${path}`, body)).status).toBe(200);
    expect(state.notifications).toHaveLength(1);
  });
  it("publishes a Gate Crew announcement with its exact channel and current gate recipients", async () => {
    const body = envelope({ title: "Gate briefing", body: "Shift instructions", channelId, recipientUserIds: [2] }, "gate");
    const created = await post("/work-hub/announcements", body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.resource.channelId).toBe(channelId);
    expect(state.notifications).toEqual([expect.objectContaining({ type: "work_hub_announcement", userIds: [2], link: `/work-hub?announcement=${created.body.resource.id}` })]);
    expect(state.notifications[0].category).toBe("work_hub_announcements");
  });
  it("emits one exact message or mention per authorized channel recipient, never unrelated users", async () => {
    const body = envelope({ body: "Gate instructions", mentionUserIds: [2, 3] }, "gate");
    const created = await post(`/work-hub/channels/${channelId}/messages`, body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(state.notifications).toEqual([expect.objectContaining({ type: "work_hub_mention", userIds: [2], link: `/work-hub/channels/${channelId}?message=${created.body.resource.id}` })]);
    expect((await post(`/work-hub/channels/${channelId}/messages`, body)).status).toBe(200);
    expect(state.notifications).toHaveLength(1);
  });
  it("rejects foreign task assignees before notifying", async () => {
    expect((await post("/work-hub/tasks", envelope({ title: "Task", assigneeUserId: 3 }))).status).toBe(404);
    expect(state.notifications).toEqual([]);
  });
  it("uses exact self Profile credential links while preserving office credential management notices", async () => {
    const at = new Date(); at.setUTCDate(at.getUTCDate() + 30);
    state.tables.employee_certifications = [{ id: 41, employeeId: 22, name: "Safety training", expirationDate: at.toISOString().slice(0, 10), deletedAt: null }];
    const results = await (await import("../lib/rules-engine")).runRulesEngine();
    expect(results.find(row => row.rule === "cert_expiring")?.error).toBeUndefined();
    const notices = state.notifications.filter(row => row.type === "cert_expiring");
    expect(notices).toContainEqual(expect.objectContaining({ userIds: [2], link: "/profile?section=compliance&credentialId=41" }));
    expect(notices).toContainEqual(expect.objectContaining({ userIds: [1], link: "/field-employees/22" }));
    expect(notices.flatMap(row => row.userIds)).toEqual([2, 1]);
  });
  it("keeps urgent Gate announcements in Gate Crew and rejects unrelated office recipients", async () => {
    const created = await post("/work-hub/announcements", envelope({ title: "Briefing", body: "Review instructions", channelId, recipientUserIds: [1, 2], urgency: "urgent" }, "gate"));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(state.notifications).toEqual([expect.objectContaining({ type: "work_hub_announcement", userIds: [2] })]);
  });
  it("does not notify a removed channel member even when supplied as a mention", async () => {
    state.revoked.add(2);
    expect((await post(`/work-hub/channels/${channelId}/messages`, envelope({ body: "Secret", mentionUserIds: [2] }, "gate"))).status).toBe(201);
    expect(state.notifications).toEqual([]);
  });
  it("emits a message without a mention to current channel members", async () => {
    const created = await post(`/work-hub/channels/${channelId}/messages`, envelope({ body: "Hello" }, "gate"));
    expect(created.status).toBe(201);
    expect(state.notifications).toEqual([expect.objectContaining({ type: "work_hub_message", userIds: [2] })]);
  });
  it("emits a completed handoff only after commit, to current gate recipients, with its exact record", async () => {
    const { transferGateShift } = await import("../services/gate-change-over");
    const { assembleShiftSnapshot } = await import("../services/gate-change-over-snapshot");
    const input = { stationId, preparationId, operationId: handoffId, acknowledged: true, revision: assembleShiftSnapshot([], [], "2026-09-24T08:00:00.000Z").revision };
    const outgoing = { userId: 1, role: "vendor", vendorId: 11, sv: 1 };
    const incoming = { userId: 2, role: "vendor", vendorId: 11, sv: 1 };
    await transferGateShift(outgoing, incoming, input);
    expect(state.notifications).toEqual([expect.objectContaining({ userIds: [2], type: "gate_handoff_ready", link: `/shift-notes?stationId=${stationId}&handoffId=${handoffId}`, dedupeKey: `gate-handoff:${handoffId}:1` })]);
    await transferGateShift(outgoing, incoming, input);
    expect(state.notifications).toHaveLength(1);
  });
  it("emits an urgent closure only on a transition to closed and preserves the exact station", async () => {
    const { setGateCoverageStatus } = await import("../services/gate-coverage-monitor");
    const session = { userId: 1, role: "vendor", vendorId: 11, sv: 1 };
    await setGateCoverageStatus(session, { stationId, mode: "closed", reason: "Safety closure" });
    expect(state.notifications).toEqual([expect.objectContaining({ type: "gate_closed", userIds: [2], link: `/gate?stationId=${stationId}`, dedupeKey: `gate-closed:${stationId}:2026-09-24T14:00:00.000Z` })]);
    await setGateCoverageStatus(session, { stationId, mode: "closed", reason: "Safety closure" });
    expect(state.notifications).toHaveLength(1);
  });
  it.each([[true, false, "safety_stop_work"], [false, true, "safety_event_hipo"]])("emits an exact safety event with canonical urgency", async (isStopWork, isHighPotential, type) => {
    const created = await post("/safety/events", { eventType: "near_miss", title: "Gate hazard", siteLocationId: 3, isStopWork, isHighPotential });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(state.notifications).toEqual([expect.objectContaining({ type, userIds: [1, 2], link: `/safety/${created.body.data.id}` })]);
  });
  it("stops urgent safety fan-out when a managed gate grant is revoked", async () => {
    state.tables.vendor_people = [];
    state.tables.managed_subcontractor_worker_sponsorships = [{ id: "sponsor", workerUserId: 2, sponsorVendorId: 11, status: "active", endedAt: null }];
    state.tables.managed_subcontractor_role_grants = [{ sponsorshipId: "sponsor", siteId: 3, role: "gate_supervisor", status: "active", endedAt: null }];
    const first = await post("/safety/events", { eventType: "near_miss", title: "First hazard", siteLocationId: 3, isHighPotential: true });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(state.notifications.at(-1)?.userIds).toEqual([1, 2]);
    state.tables.managed_subcontractor_role_grants[0].endedAt = new Date();
    const second = await post("/safety/events", { eventType: "near_miss", title: "Second hazard", siteLocationId: 3, isHighPotential: true });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(state.notifications.at(-1)?.userIds).toEqual([1]);
  });
  it("revalidates the current site gate role before reading an urgent safety event", async () => {
    const created = await post("/safety/events", { eventType: "near_miss", title: "Private hazard", siteLocationId: 3, isHighPotential: true });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    state.tables.safety_events[0].vendorId = 99;
    const gateCookie = buildTestCookie({ userId: 2, role: "vendor", vendorId: 11, vendorRole: "gatekeeper", activeMembershipId: 2, sv: 1 });
    expect((await request(app).get(`/safety/events/${created.body.data.id}`).set("Cookie", gateCookie)).status).toBe(200);
    state.revoked.add(2);
    expect((await request(app).get(`/safety/events/${created.body.data.id}`).set("Cookie", gateCookie)).status).toBe(404);
  });
  it("targets managed gate grants only while the sponsorship and grant remain current", async () => {
    state.tables.vendor_people = [];
    state.tables.managed_subcontractor_worker_sponsorships = [{ id: "sponsor", workerUserId: 2, sponsorVendorId: 11, status: "active", endedAt: null }];
    state.tables.managed_subcontractor_role_grants = [{ sponsorshipId: "sponsor", siteId: 3, role: "gate_supervisor", status: "active", endedAt: null }];
    const { setGateCoverageStatus } = await import("../services/gate-coverage-monitor");
    const session = { userId: 1, role: "vendor", vendorId: 11, sv: 1 };
    await setGateCoverageStatus(session, { stationId, mode: "closed", reason: "Closure" });
    expect(state.notifications.map(n => n.userIds)).toEqual([[2]]);
    state.tables.managed_subcontractor_role_grants[0].endedAt = new Date();
    state.coverage = null;
    await setGateCoverageStatus(session, { stationId, mode: "closed", reason: "Closure" });
    expect(state.notifications).toHaveLength(1);
  });
  it("does not emit a handoff until the incoming worker acknowledges it", async () => {
    const { transferGateShift } = await import("../services/gate-change-over");
    await expect(transferGateShift({ userId: 1 }, { userId: 2 }, { stationId, preparationId, operationId: handoffId, revision: "unused", acknowledged: false })).rejects.toMatchObject({ code: "change_over.acknowledgment_required" });
    expect(state.notifications).toEqual([]);
  });
});
