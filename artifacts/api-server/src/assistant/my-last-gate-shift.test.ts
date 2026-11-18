import { expect, it, vi } from "vitest";
import { readMyLastGateShift } from "../services/my-last-gate-shift";
const session = { userId: 7, role: "field_employee", vendorId: 2 };
const stationId = "11111111-1111-4111-8111-111111111111", handoffId = "22222222-2222-4222-8222-222222222222";
const from = "2026-11-16T00:00:00.300Z", to = "2026-11-16T12:00:00.000Z";
function dependencies() { return {
  query: vi.fn().mockResolvedValue({ rows: [{ station_id: stationId, handoff_id: handoffId }] }),
  notes: vi.fn().mockResolvedValue({ rows: [{ id: handoffId, outgoing_user_id: 7, station_id: stationId, site_id: 42, started_at: from, ended_at: to }] }),
  history: vi.fn().mockResolvedValue([{ id: "entry", gateStationId: stationId, checkInTime: new Date("2026-11-16T00:00:00.500Z") }, { id: "exit", gateStationId: stationId, checkInTime: "2026-11-15T23:00:00Z", checkOutTime: "2026-11-16T06:00:00Z" }]),
}; }
it("answers for the caller's completed shift without a selected page, site or gate", async () => {
  const deps = dependencies();
  expect(await readMyLastGateShift(session, deps)).toMatchObject({ found: true, shift: { siteId: 42, stationId, from, to }, crossings: { checkIns: 1, checkOuts: 1, total: 2 } });
  expect(deps.query.mock.calls[0][1]).toEqual([7]);
  expect(deps.query.mock.calls[0][0]).toContain("s.operator_id=$1");
  expect(deps.notes).toHaveBeenCalledWith(session, { stationId, handoffId, limit: 1 });
  expect(deps.history).toHaveBeenCalledWith(session, { reportKind: "history", filters: { siteId: 42, stationId, range: "custom", from, to, recordType: "all" } });
});
it("keeps current company/site access checks and never substitutes another operator", async () => {
  const deps = dependencies(); deps.notes.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { status: 403 }));
  await expect(readMyLastGateShift(session, deps)).rejects.toMatchObject({ status: 403 }); expect(deps.history).not.toHaveBeenCalled();
  deps.notes.mockResolvedValueOnce({ rows: [{ outgoing_user_id: 9 }] });
  await expect(readMyLastGateShift(session, deps)).rejects.toMatchObject({ status: 403 }); expect(deps.history).not.toHaveBeenCalled();
});
it("reports no saved completion instead of using the current shift or 24-hour totals", async () => {
  const deps = dependencies(); deps.query.mockResolvedValue({ rows: [] });
  expect(await readMyLastGateShift(session, deps)).toMatchObject({ found: false }); expect(deps.notes).not.toHaveBeenCalled(); expect(deps.history).not.toHaveBeenCalled();
});
