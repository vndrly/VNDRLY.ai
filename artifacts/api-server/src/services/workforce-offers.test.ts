import { beforeEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createWorkforceOffer, listWorkforceShiftOffers, respondWorkforceOffer, readWorkforceOfferOperation, listIncomingWorkforceOffers } from "./workforce-offers";

const state = vi.hoisted(() => ({ authorized: true, eligibility: true, version: 2, required: 2 }));
const shiftId = "00000000-0000-4000-8000-000000000001", offerId = "00000000-0000-4000-8000-000000000002", operationId = "00000000-0000-4000-8000-000000000003";
const shift = () => ({ id: shiftId, version: state.version, required_staff_count: state.required, qualification_codes: [], gate_station_id: offerId, site_location_id: 5,
  starts_at: "2099-10-23T10:00:00Z", ends_at: "2099-10-23T18:00:00Z", milestone_status: "upcoming", recurrence: null });
vi.mock("./gate-shift-assignment", () => ({
  GateShiftAssignmentError: class extends Error { constructor(public code: string, public status = 409) { super(code); } },
  lockShiftSchedulingRows: vi.fn(async () => undefined),
  currentGateShift: vi.fn(async () => { if (!state.authorized) throw new Error("revoked"); return shift(); }),
  guardGateShiftAssignments: vi.fn(async () => { if (!state.eligibility) throw new Error("gate_assignment.availability_required"); return { shift: shift() }; }),
}));
vi.mock("./workforce-roster", () => ({ workforceActor: vi.fn(async () => { if (!state.authorized) throw new Error("revoked"); }),
  currentWorkforceGateShift: vi.fn(async () => { if (!state.authorized) throw new Error("revoked"); return shift(); }) }));

const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 8, membershipRole: "admin", sv: 2 };
function fixture(options: { responseDropped?: boolean; assigned?: number[]; recipient?: number } = {}) {
  const receipts = new Map<string, unknown>();
  const assigned = options.assigned ?? [19];
  let status = "pending", exists = false, dropped = options.responseDropped;
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.startsWith("SELECT result_json")) { const receipt = receipts.get(`${values[0]}:${values[1]}:${values[2]}`); return { rows: receipt ? [{ result_json: receipt }] : [] }; }
    if (text.startsWith("SELECT user_id,status")) return { rows: assigned.map(user_id => ({ user_id, status: "assigned" })) };
    if (text.startsWith("SELECT id FROM work_hub_shift_requests")) return { rows: exists ? [{ id: offerId }] : [] };
    if (text.startsWith("INSERT INTO work_hub_shift_requests")) { exists = true; return { rows: [{ id: offerId }] }; }
    if (text.startsWith("SELECT * FROM work_hub_shift_requests")) return { rows: values[2] === (options.recipient ?? 18) ? [{ id: offerId, requested_by_id: 17, target_user_id: 18, status }] : [] };
    if (text.startsWith("UPDATE work_hub_shift_requests")) status = values[1] as string;
    if (text.startsWith("INSERT INTO work_hub_shift_assignments")) assigned.push(values[1] as number);
    if (text.startsWith("UPDATE work_hub_shifts")) { state.version++; return { rows: [{ version: state.version }] }; }
    if (text.startsWith("INSERT INTO work_hub_client_operations")) receipts.set(`${values[0]}:${values[1]}:${values[2]}`, JSON.parse(values[4] as string));
    if (text.startsWith("SELECT r.*,u.display_name")) return { rows: [{ id: offerId, shift_id: shiftId, target_user_id: 18, worker_name: "Gate Worker", status, created_at: "2026-10-22T10:00:00Z", decided_at: null }] };
    if (text === "COMMIT" && dropped) { dropped = false; throw new Error("lost committed response"); }
    return { rows: [] };
  });
  const database = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pick<Pool, "connect">;
  return { database, query, assigned };
}
beforeEach(() => { state.authorized = true; state.eligibility = true; state.version = 2; state.required = 2; });
it("persists an offer without assigning, recovers a committed lost response, and reads the exact receipt", async () => {
  const f = fixture({ responseDropped: true }), input = { operationId, expectedVersion: 2, workerUserId: 18 };
  await expect(createWorkforceOffer(session, shiftId, input, f.database)).rejects.toThrow("lost committed response");
  const receipt = await createWorkforceOffer(session, shiftId, input, f.database);
  expect(receipt).toMatchObject({ status: "pending", resultingVersion: 2, assignmentRecorded: false });
  expect(f.assigned).toEqual([19]);
  expect(f.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO work_hub_shift_requests"))).toHaveLength(1);
  expect(await readWorkforceOfferOperation(session, shiftId, operationId, f.database)).toEqual({ receipt });
  expect(await listWorkforceShiftOffers(session, shiftId, f.database)).toMatchObject({ shiftVersion: 2, offers: [{ status: "pending", workerUserId: 18 }] });
  await expect(createWorkforceOffer(session, shiftId, { ...input, workerUserId: 20 }, f.database)).rejects.toThrow("operation_conflict");
  state.authorized = false;
  await expect(readWorkforceOfferOperation(session, shiftId, operationId, f.database)).rejects.toThrow("revoked");
});
it("requires fresh eligibility and current version before creating an offer", async () => {
  const f = fixture(), input = { operationId, expectedVersion: 2, workerUserId: 18 };
  state.eligibility = false;
  await expect(createWorkforceOffer(session, shiftId, input, f.database)).rejects.toThrow("availability_required");
  state.eligibility = true;
  await expect(createWorkforceOffer(session, shiftId, { ...input, expectedVersion: 1 }, f.database)).rejects.toThrow("version_conflict");
  expect(f.query.mock.calls.some(([sql]) => /^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
});
it("accepts only the recipient, preserves prior assignees, and records assigned count without physical coverage", async () => {
  const f = fixture(), worker = { ...session, userId: 18 }, input = { operationId, expectedVersion: 2, decision: "accepted" };
  await expect(respondWorkforceOffer(session, shiftId, offerId, input, f.database)).rejects.toThrow("not_found");
  expect(await readWorkforceOfferOperation(worker, shiftId, operationId, f.database)).toEqual({ receipt: null });
  const receipt = await respondWorkforceOffer(worker, shiftId, offerId, input, f.database);
  expect(receipt).toMatchObject({ status: "accepted", resultingVersion: 3, assignmentRecorded: true });
  expect(f.assigned).toEqual([19, 18]);
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
  expect(await respondWorkforceOffer(worker, shiftId, offerId, input, f.database)).toEqual(receipt);
  expect(await readWorkforceOfferOperation(worker, shiftId, operationId, f.database)).toEqual({ receipt });
  const coverage = f.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO workforce_coverage_records"))![0];
  expect(coverage).toContain("DO UPDATE SET assigned_count=excluded.assigned_count");
  expect(coverage).not.toContain("state=excluded.state");
  expect(f.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO work_hub_shift_assignments"))).toHaveLength(1);
});
it.each(["eligibility", "capacity", "version"])("rejects an acceptance with changed %s without assigning", async reason => {
  const f = fixture({ assigned: reason === "capacity" ? [19, 20] : [19] });
  if (reason === "eligibility") state.eligibility = false;
  await expect(respondWorkforceOffer({ ...session, userId: 18 }, shiftId, offerId,
    { operationId, expectedVersion: reason === "version" ? 1 : 2, decision: "accepted" }, f.database)).rejects.toThrow();
  expect(f.query.mock.calls.some(([sql]) => /^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
});
it("declines without requiring current assignment eligibility or changing the schedule", async () => {
  const f = fixture(); state.eligibility = false;
  expect(await respondWorkforceOffer({ ...session, userId: 18 }, shiftId, offerId,
    { operationId, expectedVersion: 2, decision: "declined" }, f.database)).toMatchObject({ status: "declined", assignmentRecorded: false, resultingVersion: 2 });
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE work_hub_shifts") || sql.startsWith("INSERT INTO work_hub_shift_assignments"))).toBe(false);
});
it("strictly rejects extra mutation fields", async () => {
  const f = fixture();
  await expect(createWorkforceOffer(session, shiftId, { operationId, expectedVersion: 2, workerUserId: 18, override: true }, f.database)).rejects.toThrow();
  expect(f.query).not.toHaveBeenCalled();
});
