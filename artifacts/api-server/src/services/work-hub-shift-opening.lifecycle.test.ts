import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({
  shift: null as any,
  assignments: [] as any[],
  operations: new Map<string, any>(),
  updates: 0,
  audits: 0,
  revoked: false,
}));
vi.mock("@workspace/db", () => {
  const shifts = { id: "shift", table: "shifts" },
    assignments = { shiftId: "assignment", table: "assignments" },
    operations = {
      userId: "user",
      commandKind: "kind",
      operationId: "operation",
      table: "operations",
    };
  const tx = {
    select: () => {
      let table: any;
      const q: any = {
        from: (t: any) => {
          table = t;
          return q;
        },
        where: () => q,
        limit: () => q,
        for: () => q,
        then: (resolve: any, reject: any) =>
          Promise.resolve(
            table === shifts
              ? [m.shift]
              : table === assignments
                ? m.assignments
                : table === operations
                  ? [...m.operations.values()]
                  : [],
          ).then(resolve, reject),
      };
      return q;
    },
    update: () => ({
      set: (v: any) => ({
        where: () => ({
          returning: async () => {
            m.updates++;
            m.shift = { ...m.shift, ...v };
            return [m.shift];
          },
        }),
      }),
    }),
  };
  return {
    db: { transaction: async (fn: any) => fn(tx) },
    usersTable: { id: "user" },
    userOrgMembershipsTable: { id: "member", userId: "user" },
    workHubShiftsTable: shifts,
    workHubShiftAssignmentsTable: assignments,
    workHubClientOperationsTable: operations,
  };
});
vi.mock("./gate-shift-assignment", () => ({
  gateAssignmentTransactionClient: vi.fn(),
  lockShiftSchedulingRows: vi.fn(),
  authorizeGateSchedulingSite: vi.fn(),
  GateShiftAssignmentError: class extends Error {
    constructor(public code: string) {
      super(code);
    }
  },
}));
vi.mock("../assistant/chatgpt-grant-store", () => ({
  validateAssistantSession: async (s: any) => {
    if (m.revoked) throw Error("access_denied");
    return s;
  },
}));
vi.mock("../work-hub/audit", () => ({
  appendWorkHubAudit: async () => {
    m.audits++;
  },
}));
vi.mock("../work-hub/commands", () => ({
  executeWorkHubCommand: async (
    actor: any,
    kind: string,
    envelope: any,
    apply: any,
    authorize: any,
  ) => {
    const { db } = await import("@workspace/db");
    return db.transaction(async (tx: any) => {
      await authorize(tx);
      const prior = m.operations.get(envelope.operationId);
      if (prior) return { resource: prior.resultJson, replayed: true };
      const receipt = await apply(tx);
      m.operations.set(envelope.operationId, {
        resultJson: receipt,
        appliedAt: new Date(),
        ownerOrgType: envelope.owner.type,
        ownerOrgId: envelope.owner.id,
      });
      return { resource: receipt, replayed: false };
    });
  },
}));
import {
  setWorkHubShiftOpening,
  readWorkHubShiftOpening,
} from "./work-hub-shift-opening";
const actor = {
    userId: 1072,
    role: "vendor",
    vendorId: 1107,
    membershipRole: "admin",
    activeMembershipId: 798,
    sv: 2,
  },
  id = "22222222-2222-4222-8222-222222222222";
const command = () => ({
  operationId: randomUUID(),
  owner: { type: "vendor" as const, id: 1107 },
  context: { kind: "organization" as const, id: 1107 },
  expectedVersion: 2,
  payloadVersion: 1 as const,
  payload: { action: "update", open: true },
});
beforeEach(() => {
  m.shift = {
    id,
    ownerOrgType: "vendor",
    ownerOrgId: 1107,
    siteLocationId: 392,
    gateStationId: null,
    startsAt: new Date(Date.now() + 86400000),
    endsAt: new Date(Date.now() + 90000000),
    milestoneStatus: "upcoming",
    version: 2,
    open: false,
  };
  m.assignments = [];
  m.operations.clear();
  m.updates = 0;
  m.audits = 0;
  m.revoked = false;
});
describe("claim window saved command lifecycle", () => {
  it("opens once, recovers exact receipt and preserves immutable retry after assignments", async () => {
    const body = command(),
      receipt = await setWorkHubShiftOpening(actor, id, body, "web");
    expect(receipt).toMatchObject({
      previousVersion: 2,
      resultingVersion: 3,
      open: true,
      physicalAttendanceVerified: false,
    });
    expect(m.updates).toBe(1);
    expect(m.audits).toBe(1);
    expect(await readWorkHubShiftOpening(actor, id, body.operationId)).toEqual(
      receipt,
    );
    m.assignments = [{ id: "assigned" }];
    expect(await setWorkHubShiftOpening(actor, id, body, "web")).toEqual(
      receipt,
    );
    expect(m.updates).toBe(1);
    expect(m.audits).toBe(1);
  });
  it("refuses changed intent or target using a saved operation without effects", async () => {
    const body = command();
    await setWorkHubShiftOpening(actor, id, body, "web");
    await expect(
      setWorkHubShiftOpening(
        actor,
        id,
        { ...body, payload: { action: "update", open: false } },
        "web",
      ),
    ).rejects.toThrow("work_hub.invalid_operation");
    await expect(
      setWorkHubShiftOpening(
        actor,
        "33333333-3333-4333-8333-333333333333",
        body,
        "web",
      ),
    ).rejects.toThrow("work_hub.invalid_operation");
    expect(m.updates).toBe(1);
  });
  it("denies revoked membership, ordinary worker and foreign company before saved replay or write", async () => {
    const body = command();
    await setWorkHubShiftOpening(actor, id, body, "web");
    m.revoked = true;
    await expect(
      readWorkHubShiftOpening(actor, id, body.operationId),
    ).rejects.toThrow();
    await expect(
      setWorkHubShiftOpening(actor, id, body, "web"),
    ).rejects.toThrow();
    m.revoked = false;
    await expect(
      setWorkHubShiftOpening(
        { ...actor, role: "field_employee", membershipRole: "member" },
        id,
        command(),
        "web",
      ),
    ).rejects.toThrow();
    await expect(
      setWorkHubShiftOpening(
        { ...actor, vendorId: 1108 },
        id,
        command(),
        "web",
      ),
    ).rejects.toThrow();
    expect(m.updates).toBe(1);
  });
  it("refuses stale, terminal or assigned snapshots without touching state", async () => {
    const body = command();
    await expect(
      setWorkHubShiftOpening(actor, id, { ...body, expectedVersion: 1 }, "web"),
    ).rejects.toThrow("version_conflict");
    m.shift.milestoneStatus = "cancelled";
    await expect(
      setWorkHubShiftOpening(actor, id, body, "web"),
    ).rejects.toThrow();
    m.shift.milestoneStatus = "completed";
    await expect(
      setWorkHubShiftOpening(actor, id, body, "web"),
    ).rejects.toThrow();
    m.shift.milestoneStatus = "upcoming";
    m.assignments = [{}];
    await expect(
      setWorkHubShiftOpening(actor, id, body, "web"),
    ).rejects.toThrow();
    expect(m.updates).toBe(0);
    expect(m.audits).toBe(0);
  });
});
