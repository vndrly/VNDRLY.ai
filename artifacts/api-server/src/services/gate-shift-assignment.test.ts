import { beforeEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import { authorizeGateSchedulingSite, gateAssignmentTransactionClient, lockShiftSchedulingRows, executeGateShiftAssignment, executeGateShiftClaim, readGateShiftAssignment, readShiftCreationOperation } from "./gate-shift-assignment";
import { readGateStaffingCandidatesForClient } from "../assistant/gate-staffing-candidates";

const authority = vi.hoisted(() => ({ current: true }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: vi.fn(async (session) => {
  if (!authority.current) throw Error("access_denied"); return session;
}) }));
vi.mock("./gate-change-over", () => ({ requireChangeOverAccess: vi.fn(async () => ({ supervisor: true })) }));
vi.mock("../assistant/gate-staffing-candidates", () => ({ readGateStaffingCandidatesForClient: vi.fn(async () => ({
  shiftVersion: 2, candidates: [{ userId: 18, requirements: [], availability: "recorded_available", eligibility: { allowed: true, overrideRequired: false } }],
})) }));
const shiftId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";
const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 8, membershipRole: "admin", sv: 2 };
function fixture(dropCommit = false, fleetConflict = false) {
  let saved: unknown = null;
  let version = 2;
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.startsWith("SELECT 1 FROM vendors v CROSS JOIN LATERAL")) return { rows: fleetConflict ? [{ conflict: 1 }] : [], rowCount: fleetConflict ? 1 : 0 };
    if (text.startsWith("SELECT s.*")) return { rows: [{ id: shiftId, version, site_location_id: 392, gate_station_id: operationId, qualification_codes: [], open: true }], rowCount: 1 };
    if (text.startsWith("SELECT id FROM work_hub_shift_assignments WHERE shift_id")) return { rows: [], rowCount: 0 };
    if (text.startsWith("SELECT result_json")) return { rows: saved ? [{ result_json: saved }] : [], rowCount: saved ? 1 : 0 };
    if (text.startsWith("UPDATE work_hub_shifts")) { version++; return { rows: [{ version }], rowCount: 1 }; }
    if (text.startsWith("INSERT INTO work_hub_client_operations")) saved = JSON.parse(values[4] as string);
    if (text === "COMMIT" && dropCommit) { dropCommit = false; throw Error("response dropped after commit"); }
    return { rows: [{ id: 1 }], rowCount: 1 };
  });
  const database = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pick<Pool, "connect">;
  return { database, query };
}
beforeEach(() => { authority.current = true; });
it("refuses a current scheduled Fleet conflict before creating Gate assignment or receipt", async () => {
  const f = fixture(false, true);
  await expect(executeGateShiftAssignment(session, shiftId, { operationId, expectedVersion: 2, assigneeUserIds: [18] }, f.database)).rejects.toThrow("work_hub.assignment_conflict");
  expect(f.query.mock.calls.some(([text]) => /^(INSERT|UPDATE|DELETE)/.test(text))).toBe(false);
  const query = f.query.mock.calls.find(([text]) => text.startsWith("SELECT 1 FROM vendors v CROSS JOIN LATERAL"))!;
  expect(query[0]).toContain("'dispatched','acknowledged','in_progress'");
  expect(query[0]).toContain("run->'schedule'<>'null'::jsonb");
});
it("creation readback returns only the original actor's saved resource and refuses revoked authority", async () => {
  const resource = { id: shiftId, ownerOrgType: "vendor", ownerOrgId: 4, createdById: 17, assigneeUserIds: [18], open: false };
  const query = vi.fn(async (text: string) => {
    if (text.startsWith("SELECT * FROM work_hub_client_operations")) return { rows: [{ result_json: resource, owner_org_type: "vendor", owner_org_id: 4, applied_at: "2026-10-07T12:00:00Z" }] };
    if (text.startsWith("SELECT * FROM work_hub_shifts")) return { rows: [{ gate_station_id: operationId, site_location_id: 392 }] };
    return { rows: [{ id: 1 }], rowCount: 1 };
  });
  const database = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pick<Pool, "connect">;
  expect(await readShiftCreationOperation(session, operationId, database)).toEqual({ receipt: { operationId, appliedAt: "2026-10-07T12:00:00.000Z", replayed: true, resource } });
  expect(query.mock.calls.find(([text]) => text.startsWith("SELECT * FROM work_hub_client_operations"))![0]).toContain("user_id=$1");
  authority.current = false;
  await expect(readShiftCreationOperation(session, operationId, database)).rejects.toThrow("access_denied");
  expect(query.mock.calls.some(([text]) => /^(INSERT|UPDATE|DELETE)/.test(text))).toBe(false);
});
it("saves exact CAS assignment once and recovers a dropped committed response with original receipt", async () => {
  const f = fixture(true), input = { operationId, expectedVersion: 2, assigneeUserIds: [18] };
  await expect(executeGateShiftAssignment(session, shiftId, input, f.database)).rejects.toThrow("response dropped");
  const receipt = await executeGateShiftAssignment(session, shiftId, input, f.database);
  expect(receipt).toMatchObject({ operationId, actorUserId: 17, previousVersion: 2, resultingVersion: 3, assigneeUserIds: [18], physicalAttendanceVerified: false });
  expect(f.query.mock.calls.filter(([text]) => text.startsWith("UPDATE work_hub_shifts"))).toHaveLength(1);
  expect(await readGateShiftAssignment(session, shiftId, operationId, f.database)).toEqual({ receipt });
});
it("rechecks current membership before saved receipt replay or readback", async () => {
  const f = fixture(), input = { operationId, expectedVersion: 2, assigneeUserIds: [18] };
  await executeGateShiftAssignment(session, shiftId, input, f.database);
  authority.current = false;
  await expect(executeGateShiftAssignment(session, shiftId, input, f.database)).rejects.toThrow("access_denied");
  await expect(readGateShiftAssignment(session, shiftId, operationId, f.database)).rejects.toThrow("access_denied");
  expect(f.query.mock.calls.filter(([text]) => text.startsWith("UPDATE work_hub_shifts"))).toHaveLength(1);
});
it("refuses altered exact-operation payload and foreign candidate without a write", async () => {
  const f = fixture(), input = { operationId, expectedVersion: 2, assigneeUserIds: [18] };
  await executeGateShiftAssignment(session, shiftId, input, f.database);
  await expect(executeGateShiftAssignment(session, shiftId, { ...input, assigneeUserIds: [] }, f.database)).rejects.toThrow("operation_conflict");
  const other = fixture();
  await expect(executeGateShiftAssignment(session, shiftId, { ...input, assigneeUserIds: [19] }, other.database)).rejects.toThrow("candidate_unavailable");
  expect(other.query.mock.calls.some(([text]) => text.startsWith("UPDATE work_hub_shifts"))).toBe(false);
});
it("records self-claim with an exact operation and recovers it without another assignment", async () => {
  const f = fixture();
  const worker = { ...session, role: "field_employee", vendorRole: "gatekeeper", membershipRole: "member" };
  vi.mocked(readGateStaffingCandidatesForClient).mockResolvedValueOnce({
    shiftVersion: 2, candidates: [{ userId: worker.userId, requirements: [], availability: "recorded_available", eligibility: { allowed: true, overrideRequired: false } }],
  } as never);
  const input = { operationId, expectedVersion: 2 };
  const receipt = await executeGateShiftClaim(worker, shiftId, input, f.database);
  expect(await executeGateShiftClaim(worker, shiftId, input, f.database)).toEqual(receipt);
  expect(await readGateShiftAssignment(worker, shiftId, operationId, f.database, true)).toEqual({ receipt });
  expect(f.query.mock.calls.filter(([text]) => text.startsWith("INSERT INTO work_hub_shift_requests"))).toHaveLength(1);
  expect(f.query.mock.calls.find(([text]) => text.startsWith("UPDATE work_hub_shifts"))![1]).toEqual([shiftId, 2, true]);
  expect(() => executeGateShiftClaim(worker, shiftId, { ...input, assigneeUserIds: [18] }, f.database)).toThrow();
});

it("locks sorted users before the complete sorted shift set and refuses a newly introduced assignee", async () => {
  const query = vi.fn(async (text: string, _values?: unknown[]) => ({ rows: text.startsWith("SELECT user_id") ? [{user_id: 19}] : text.startsWith("SELECT s.id") ? [{id:shiftId}] : [] }));
  await lockShiftSchedulingRows({query} as never, 17, shiftId, [20,18]);
  const calls=query.mock.calls;
  const users=calls.findIndex(([text])=>text.includes("FROM users"));
  const shifts=calls.findIndex(([text])=>text.includes("FROM work_hub_shifts"));
  expect(users).toBeLessThan(shifts);
  expect(calls[shifts][0]).toContain("ORDER BY s.id FOR UPDATE");
  expect((query.mock.calls as unknown[][])[users][1]).toEqual([ [17,18,19,20] ]);
  let reads=0;
  const changed=vi.fn(async(text:string)=>({rows:text.startsWith("SELECT user_id")?(++reads===1?[]:[{user_id:21}]):[]}));
  await expect(lockShiftSchedulingRows({query:changed} as never,17,shiftId,[18])).rejects.toThrow("version_conflict");
  expect(changed.mock.calls.some(([text])=>text.includes("FROM work_hub_shifts"))).toBe(false);
});

it("does not confuse the pg connection database name with the same-transaction authorization database", async () => {
  const { validateAssistantSession } = await import("../assistant/chatgpt-grant-store");
  const validate = vi.mocked(validateAssistantSession);
  const query = vi.fn(async () => ({ rows: [{id:1}] }));
  await authorizeGateSchedulingSite({database:"synthetic_database_name",query} as never,session,392,operationId);
  const rawDatabase=validate.mock.calls.at(-1)![1];
  expect(typeof rawDatabase!.select).toBe("function");
  expect(rawDatabase).not.toBe("synthetic_database_name");
  const transaction={select:vi.fn(),execute:vi.fn(async()=>({rows:[{id:1}]}))};
  await authorizeGateSchedulingSite(gateAssignmentTransactionClient(transaction as never),session,392,operationId);
  expect(validate.mock.calls.at(-1)![1]).toBe(transaction);
  expect(transaction.execute).toHaveBeenCalled();
});

it.each([{ value: [] }, { value: [133] }, { value: [133, 134] }, { value: null }])("preserves array/null as a single PostgreSQL parameter: $value", async ({ value }) => {
  const dialect = new PgDialect();
  const execute = vi.fn(async (query) => {
    const compiled = dialect.sqlToQuery(query);
    expect(compiled.sql).toBe("SELECT id FROM users WHERE id=ANY($1::integer[]) OR $2::integer[] IS NULL OR id=ANY($3::integer[])");
    expect(compiled.params).toEqual([value, value, value]);
    expect(compiled.params[0]).toBe(value);
    return { rows: [{ id: 133 }] };
  });
  const client = gateAssignmentTransactionClient({ execute } as never);
  expect(await client.query("SELECT id FROM users WHERE id=ANY($1::integer[]) OR $1::integer[] IS NULL OR id=ANY($1::integer[])", [value])).toMatchObject({ rows: [{ id: 133 }], rowCount: 1 });
  expect(execute).toHaveBeenCalledOnce();
});
