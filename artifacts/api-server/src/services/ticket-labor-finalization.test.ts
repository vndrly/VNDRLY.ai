import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
const auth = vi.hoisted(() => ({ valid: true, readable: true }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: async () => { if (!auth.valid) throw Error("revoked"); } }));
vi.mock("../lib/field-ticket-access", () => ({ canReadTicket: async () => auth.readable }));
import { authorizeTicketLaborFinalization, createTicketLaborFinalizationService, TicketLaborFinalizationError } from "./ticket-labor-finalization";
const session = { userId: 9, role: "vendor", vendorId: 4, sv: 1, activeMembershipId: 5 };
const version = "2026-10-07T10:00:00.000Z";
function fixture() {
  let row = { id: 7, vendor_id: 4, status: "pending_review", closed_at: null as Date | null, closed_by_id: null as number | null, updated_at: new Date(version) };
  let audits: any[] = [], snapshot: any;
  const calls: string[] = [];
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push(sql);
      if (sql === "BEGIN") snapshot = { row: { ...row }, audits: [...audits] };
      if (sql === "ROLLBACK") { row = snapshot.row; audits = snapshot.audits; }
      if (sql.startsWith("SELECT id,vendor_id")) return { rows: [row] };
      if (sql.startsWith("SELECT user_id,tool_input")) return { rows: audits.filter(x => x.op === params[0]) };
      if (sql.startsWith("UPDATE tickets SET closed_at")) row = { ...row, closed_at: params[1], closed_by_id: params[2], updated_at: params[3] };
      if (sql.startsWith("INSERT INTO assistant_action_audit")) audits.push({ user_id: params[0], op: params[4], tool_input: JSON.parse(params[5]), tool_output: JSON.parse(params[6]) });
      return { rows: [] };
    }),
  } as unknown as PoolClient;
  const authorize = vi.fn(async () => { if (!auth.valid || !auth.readable) throw new TicketLaborFinalizationError("ticket.no_access", 403); });
  const regen = vi.fn(async () => 2);
  const service = createTicketLaborFinalizationService({ connect: async () => client } as unknown as Pool, authorize, regen);
  return { service, client, authorize, regen, calls, row: () => row, audits: () => audits };
}
describe("exact transactional labor finalization", () => {
  it("freezes once, preserves office/field status and returns exact saved receipt after a dropped response", async () => {
    auth.valid = auth.readable = true;
    const f = fixture(), command = { operationId: randomUUID(), expectedUpdatedAt: version };
    const saved = await f.service.apply(session, 7, command);
    expect(saved).toMatchObject({ ticketId: 7, actorUserId: 9, autoLaborLineCount: 2, physicalWorkVerified: false, submitted: false });
    expect(await f.service.read(session, 7, command.operationId)).toEqual(saved);
    expect(await f.service.apply(session, 7, command)).toEqual(saved);
    expect(f.regen).toHaveBeenCalledTimes(1);
    expect(f.audits()).toHaveLength(1);
    expect(f.row().status).toBe("pending_review");
    expect(await f.service.canFinalize(session, 7)).toBe(false);
    await expect(f.service.apply(session, 7, { ...command, expectedUpdatedAt: "2026-10-07T11:00:00.000Z" })).rejects.toMatchObject({ code: "ticket.state_changed" });
  });
  it("refuses stale review before regeneration and retains unknown absence as read-only", async () => {
    auth.valid = auth.readable = true;
    const f = fixture();
    expect(await f.service.canFinalize(session, 7)).toBe(true);
    expect(await f.service.read(session, 7, randomUUID())).toBeNull();
    await expect(f.service.apply(session, 7, { operationId: randomUUID(), expectedUpdatedAt: "2026-10-07T09:00:00.000Z" })).rejects.toMatchObject({ code: "ticket.state_changed" });
    expect(f.regen).not.toHaveBeenCalled();
    expect(f.row().closed_at).toBeNull();
  });
  it("rolls back regeneration failure and audit failure instead of leaving a half-frozen ticket", async () => {
    auth.valid = auth.readable = true;
    const f = fixture();
    f.regen.mockRejectedValueOnce(Error("regeneration failed"));
    await expect(f.service.apply(session, 7, { operationId: randomUUID(), expectedUpdatedAt: version })).rejects.toThrow("regeneration failed");
    expect(f.row().closed_at).toBeNull();
    const original = vi.mocked(f.client.query).getMockImplementation()!;
    vi.spyOn(f.client, "query").mockImplementation((async (sql: string, params: any[]) => { if (sql.startsWith("INSERT INTO assistant_action_audit")) throw Error("audit failed"); return (original as any)(sql, params); }) as any);
    await expect(f.service.apply(session, 7, { operationId: randomUUID(), expectedUpdatedAt: version })).rejects.toThrow("audit failed");
    expect(f.row().closed_at).toBeNull();
    expect(f.audits()).toHaveLength(0);
  });
  it("rechecks current authority on receipt reads and exact replay", async () => {
    auth.valid = auth.readable = true;
    const f = fixture(), command = { operationId: randomUUID(), expectedUpdatedAt: version };
    await f.service.apply(session, 7, command);
    auth.valid = false;
    await expect(f.service.read(session, 7, command.operationId)).rejects.toMatchObject({ status: 403 });
    await expect(f.service.apply(session, 7, command)).rejects.toMatchObject({ status: 403 });
    expect(await f.service.canFinalize(session, 7)).toBe(false);
    auth.valid = true;
  });
});
it("uses canonical current ticket access and persisted active foreman authority, never worker role labels alone", async () => {
  auth.valid = auth.readable = true;
  const ticket = { id: 7, vendor_id: 4, status: "pending_review", closed_at: null, updated_at: new Date(version) };
  let activeForeman = false;
  const client = { query: vi.fn(async (sql: string) => ({ rows: sql.includes("vendor_role IN") && activeForeman ? [{ id: 12 }] : [] })) } as unknown as PoolClient;
  const worker = { ...session, role: "field_employee", vendorPeopleId: 12 };
  await expect(authorizeTicketLaborFinalization(client, worker, ticket)).rejects.toMatchObject({ status: 403 });
  activeForeman = true;
  await expect(authorizeTicketLaborFinalization(client, worker, ticket)).resolves.toBeUndefined();
  auth.readable = false;
  await expect(authorizeTicketLaborFinalization(client, worker, ticket)).rejects.toMatchObject({ status: 403 });
  auth.readable = true;
  await expect(authorizeTicketLaborFinalization(client, { ...session, vendorId: 8 }, ticket)).rejects.toMatchObject({ status: 403 });
});
