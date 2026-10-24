import { beforeEach, describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
const state = vi.hoisted(() => ({
  session: null as any,
  query: vi.fn(),
  execute: vi.fn(),
  guard: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: {transaction:async (apply:any)=>apply({})},
  pool: { query: state.query },
  workforceCoverageResolutionsTable: {},
  workHubShiftRequestsTable: { id: "id" },
}));
vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => state.session,
}));
vi.mock("../assistant/chatgpt-grant-store", () => ({
  validateAssistantSession: async (s: unknown) => s,
}));
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: vi.fn() }));
vi.mock("../work-hub/commands", () => ({
  executeWorkHubCommand: state.execute,
}));
vi.mock("../services/gate-shift-assignment", () => ({
  gateAssignmentTransactionClient: () => ({ query: state.query }),
  lockShiftSchedulingRows: vi.fn(),
  guardGateShiftAssignments: state.guard,
}));
import router from "./coverageWorkflow";
import {calendarWorkerScope} from '../work-hub/calendar-worker-scope';
const app = express().use(express.json()).use(router);
const shiftId = "33333333-3333-4333-8333-333333333333";
const envelope = (payload: unknown) => ({
  operationId: "44444444-4444-4444-8444-444444444444",
  owner: { type: "vendor", id: 5 },
  context: { kind: "organization", id: 5 },
  expectedVersion: null,
  payloadVersion: 1,
  payload,
});
beforeEach(() => {
  state.session = {
    userId: 7,
    vendorId: 5,
    role: "field_employee",
    membershipRole: "member",
  };
  state.query.mockReset().mockResolvedValue({ rows: [] });
  state.insert.mockReset();
  state.guard.mockReset();
  state.execute.mockReset().mockImplementation(async (_a, _k, _e, apply) => ({
    resource: await apply({
      insert: () => ({
        values: (v: unknown) => {
          state.insert(v);
          return { returning: async () => [{ id: "new" }] };
        },
      }),
    }),
  }));
});
describe("coverage access and request safety", () => {
  it("blocks non-admin coverage management", async () => {
    expect(
      (
        await request(app).get(
          "/coverage-facts?type=vendor&id=5&from=2099-10-25&through=2099-10-25",
        )
      ).status,
    ).toBe(403);
    expect(state.query).not.toHaveBeenCalled();
  });
  it("reads only the signed-in gatekeeper's shifts, ignoring another user parameter", async () => {
    expect(
      (
        await request(app).get(
          "/my-coverage?from=2099-10-25&through=2099-10-25&userId=99",
        )
      ).status,
    ).toBe(200);
    expect(state.query.mock.calls[0][1][0]).toBe(7);
  });
  it("rejects a request for a shift the gatekeeper does not own", async () => {
    expect(
      (
        await request(app)
          .post("/request-coverage")
          .send(envelope({ shiftId, expectedVersion: 1 }))
      ).status,
    ).toBe(403);
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("creates a pending request without updating any assignment", async () => {
    state.query
      .mockResolvedValueOnce({ rows: [{ id: shiftId }] })
      .mockResolvedValueOnce({ rows: [] });
    expect(
      (
        await request(app)
          .post("/request-coverage")
          .send(envelope({ shiftId, expectedVersion: 1 }))
      ).status,
    ).toBe(200);
    expect(state.insert).toHaveBeenCalledWith({
      shiftId,
      requestType: "coverage",
      requestedById: 7,
      status: "pending",
    });
    expect(
      state.query.mock.calls.every(
        (c) => !/^\s*(UPDATE|DELETE|INSERT)/i.test(c[0]),
      ),
    ).toBe(true);
  });
  it("does not create duplicate pending requests", async () => {
    state.query
      .mockResolvedValueOnce({ rows: [{ id: shiftId }] })
      .mockResolvedValueOnce({ rows: [{ id: "existing" }] });
    expect(
      (
        await request(app)
          .post("/request-coverage")
          .send(envelope({ shiftId, expectedVersion: 1 }))
      ).status,
    ).toBe(200);
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("fails closed when resolution storage has not been installed", async () => {
    state.session.membershipRole = "admin";
    state.query.mockResolvedValue({ rows: [{ ready: false }] });
    expect(
      (
        await request(app)
          .post("/coverage-resolution")
          .send(
            envelope({
              shiftId,
              expectedVersion: 1,
              originalUserId: 7,
              replacementUserId: 8,
              kind: "temporary",
              requestId: null,
            }),
          )
      ).status,
    ).toBe(503);
    expect(state.execute).not.toHaveBeenCalled();
  });
  it("temporary replacement changes only the selected shift and records the original responsibility", async () => {
    state.session.membershipRole = "admin";
    const anchor = {
      id: shiftId,
      site_location_id: 9,
      gate_station_id: "station",
      starts_at: "2099-10-25T11:00:00Z",
      ends_at: "2099-10-25T23:00:00Z",
      timezone: "America/Chicago",
      weekday: 0,
      starts: "06:00",
      ends: "18:00",
      day: "2099-10-25",
      required_staff_count: 1,
      title: "Main Gate Night",
    };
    state.query.mockImplementation(async (q: string) => ({
      rows: q.includes("to_regclass")
        ? [{ ready: true }]
        : q.includes("SELECT s.*")
          ? [anchor]
          : q.includes("SELECT DISTINCT p.user_id") ? [{id:8}]
          : q.startsWith("SELECT user_id")
            ? [{ user_id: 7 }]
            : [],
    }));
    const result = await request(app)
      .post("/coverage-resolution")
      .send(
        envelope({
          shiftId,
          expectedVersion: 1,
          originalUserId: 7,
          replacementUserId: 8,
          kind: "temporary",
          requestId: null,
        }),
      );
    expect(result.status).toBe(200);
    expect(state.guard).not.toHaveBeenCalled();
    expect(state.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorShiftId: shiftId,
        originalUserId: 7,
        replacementUserId: 8,
        kind: "temporary",
      }),
    );
    const writes = state.query.mock.calls.filter((c) =>
      /^(UPDATE|INSERT)/.test(c[0]),
    );
    const assignments=writes.filter(c=>c[0].includes('work_hub_shift_assignments') || c[0].includes('UPDATE work_hub_shifts'));
    expect(assignments).toHaveLength(3);
    expect(assignments.every((c) => c[1][0] === shiftId)).toBe(true);
    const notice=writes.find(c=>c[0].startsWith('INSERT INTO notifications'))!;
    expect(notice[1][0]).toBe(8);
    expect(notice[1][2]).toBe(`coverage:${shiftId}:44444444-4444-4444-8444-444444444444`);
    expect(notice[0]).toContain('acknowledgement_required');
    expect(writes.find(c=>c[0].startsWith('UPDATE notifications'))![1]).toEqual([shiftId,[8,7]]);
  });
  it("rejects a conflicting replacement before changing any assignment", async () => {
    state.session.membershipRole = "admin";
    state.query.mockImplementation(async (q: string) => ({
      rows: q.includes("to_regclass")
        ? [{ ready: true }]
        : q.includes("SELECT s.*")
          ? [{ id: shiftId, gate_station_id: "station" }]
          : q.includes("SELECT DISTINCT p.user_id") ? [{id:8}]
          : q.includes("SELECT DISTINCT a.user_id") ? [{user_id:8}]
          : q.startsWith("SELECT user_id")
            ? [{ user_id: 7 }]
            : [],
    }));
    state.guard.mockRejectedValue(Error("gate_assignment.policy_denied"));
    expect(
      (
        await request(app)
          .post("/coverage-resolution")
          .send(
            envelope({
              shiftId,
              expectedVersion: 1,
              originalUserId: 7,
              replacementUserId: 8,
              kind: "temporary",
              requestId: null,
            }),
          )
      ).status,
    ).toBe(409);
    expect(
      state.query.mock.calls.some((c) => /^(UPDATE|INSERT|DELETE)/.test(c[0])),
    ).toBe(false);
    expect(state.insert).not.toHaveBeenCalled();
  });
});

describe('coverage acknowledgment',()=>{
  it('returns only the current gatekeeper’s pending notices',async()=>{
    await request(app).get('/my-coverage-acknowledgments?userId=99');
    expect(state.query.mock.calls[0][1]).toEqual([5,7]);
    expect(state.query.mock.calls[0][0]).toContain("a.status NOT IN ('cancelled','declined')");
  });
  it('rejects another recipient without writing anything',async()=>{
    expect((await request(app).post('/acknowledge-coverage').send({notificationId:12})).status).toBe(403);
    expect(state.query.mock.calls).toHaveLength(1);
    expect(state.query.mock.calls[0][1]).toEqual([12,7,5]);
  });
  it('acknowledges only the current notice without altering an assignment',async()=>{
    state.query.mockResolvedValueOnce({rows:[{id:shiftId}]}).mockResolvedValueOnce({rows:[{id:12}]});
    expect((await request(app).post('/acknowledge-coverage').send({notificationId:12})).status).toBe(200);
    const update=state.query.mock.calls[1];
    expect(update[1]).toEqual([12,7,shiftId]);
    expect(update[0]).toContain('COALESCE(n.acknowledged_at,now())');
    expect(update[0]).toContain('n.acknowledgement_required=true');
    expect(state.query.mock.calls.some(c=>/UPDATE work_hub_shift/.test(c[0]))).toBe(false);
  });
  it('rejects a notice retired by reassignment',async()=>{
    state.query.mockResolvedValueOnce({rows:[{id:shiftId}]}).mockResolvedValueOnce({rows:[]});
    expect((await request(app).post('/acknowledge-coverage').send({notificationId:12})).status).toBe(409);
  });
});

describe('shift-off decisions and calendar scope',()=>{
  const requestId='55555555-5555-4555-8555-555555555555';
  it('scopes a gatekeeper to their own calendar and rejects another person',()=>{
    expect(calendarWorkerScope({...state.session,vendorRole:'gatekeeper'})).toBe(7);
    expect(()=>calendarWorkerScope({...state.session,vendorRole:'gatekeeper'},99)).toThrow();
    expect(calendarWorkerScope({...state.session,membershipRole:'admin'})).toBeUndefined();
  });
  it.each(['approved','declined'])('records %s without changing assignments',async decision=>{
    state.session.membershipRole='admin';state.query.mockResolvedValue({rows:[{id:requestId}]});
    expect((await request(app).post('/decide-shift-off').send(envelope({requestId,shiftId,decision}))).status).toBe(200);
    expect(state.query.mock.calls).toHaveLength(1);
    expect(state.query.mock.calls[0][0]).toContain("r.status='pending'");
    expect(state.query.mock.calls[0][1]).toEqual([decision,7,requestId,shiftId,5]);
    expect(state.query.mock.calls.some(c=>/UPDATE work_hub_shift_assignments/.test(c[0]))).toBe(false);
  });
  it('blocks a gatekeeper from approving their own request',async()=>{
    expect((await request(app).post('/decide-shift-off').send(envelope({requestId,shiftId,decision:'approved'}))).status).toBe(403);
    expect(state.query).not.toHaveBeenCalled();
  });
  it('rejects a stale decision',async()=>{
    state.session.membershipRole='admin';
    expect((await request(app).post('/decide-shift-off').send(envelope({requestId,shiftId,decision:'approved'}))).status).toBe(409);
  });
  it('blocks reassignment of a pending shift-off request before any write',async()=>{
    state.session.membershipRole='admin';
    state.query.mockImplementation(async(q:string)=>({rows:q.includes('to_regclass')?[{ready:true}]:q.includes('SELECT s.*')?[{id:shiftId,gate_station_id:'station'}]:q.includes('SELECT id,status')?[{id:requestId,status:'pending'}]:[]}));
    expect((await request(app).post('/coverage-resolution').send(envelope({shiftId,expectedVersion:1,originalUserId:7,replacementUserId:8,kind:'temporary',requestId}))).status).toBe(409);
    expect(state.query.mock.calls.some(c=>/^\s*(INSERT|UPDATE)/.test(c[0]))).toBe(false);
  });
});
