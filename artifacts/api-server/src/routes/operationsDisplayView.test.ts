import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), request: vi.fn(), gate: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("../assistant/natural-voice-write-tools", () => ({ callNaturalVoiceDomainApi: mocks.request }));
vi.mock("../services/gate-change-over", () => ({ requireChangeOverAccess: mocks.gate }));
import { authorizeDisplayView, readDisplayViewRecords } from "./operationsDisplayView";
const id = "00000000-0000-4000-8000-000000000001", monitorId = "00000000-0000-4000-8000-000000000002";
const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 12, membershipRole: "admin", sv: 1 };
const state = { displayId: id, monitorId, displayName: "Desk", monitorName: "Left", view: "gate_log" as const, privacyMode: true, siteLocationId: 392, meetingOccurrenceId: null, configuredAt: "2026-10-07T10:00:00.123Z" };
beforeEach(() => { vi.resetAllMocks(); });
it("binds exact current actor/membership/SV/device and checks canonical Gate authority", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [{ id, name: "Desk", monitor_id: monitorId, monitor_name: "Left", privacy_mode: true, site_allowlist: [392], view_allowlist: ["gate_log"], current_view: "gate_log", current_site_location_id: 392, current_meeting_occurrence_id: null, updated_at: new Date(state.configuredAt) }] }).mockResolvedValueOnce({ rows: [{ partner_id: 8 }] }).mockResolvedValueOnce({ rows: [{ id: 9 }] });
  expect(await authorizeDisplayView(session, id, monitorId)).toEqual(state);
  expect(mocks.query.mock.calls[0][1]).toEqual([id, monitorId, 17, 12, "vendor", 4, 1, false]);
  const sql = mocks.query.mock.calls[0][0];
  for (const condition of ["d.revoked_at IS NULL", "u.session_version=$7", "u.suspended_at IS NULL", "c.revoked_at IS NULL", "m.role='admin'"]) expect(sql).toContain(condition);
  expect(mocks.gate).toHaveBeenCalledExactlyOnceWith(expect.anything(), session, 392);
});
it("returns no viewer for foreign/revoked state and ordinary members without current admin row", async () => {
  mocks.query.mockResolvedValue({ rows: [] }); expect(await authorizeDisplayView(session, id, monitorId)).toBeNull();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("reads only saved Gate site and uses canonical time fields without exposing private names", async () => {
  mocks.request.mockResolvedValue([{ id: 1, firstName: "PRIVATE", checkInTime: state.configuredAt, checkOutTime: null, vehiclePlate: "PRIVATE", admissionStatus: "pending" }]);
  expect(await readDisplayViewRecords(state, session)).toEqual({ records: [{ id: "visit:1", title: "Visit 1", status: "pending_admission", detail: "Recorded Gate visit", sourceRecordedAt: state.configuredAt }], truncated: false });
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith("/visits?siteLocationId=392&limit=100&offset=0", "GET", {}, session);
});
it("coverage joins exact saved site and company without global admin query fallback", async () => {
  mocks.query.mockResolvedValue({ rows: [] }); expect(await readDisplayViewRecords({ ...state, view: "coverage" }, session)).toEqual([]);
  expect(mocks.query.mock.calls[0][0]).toContain("s.site_location_id=$3"); expect(mocks.query.mock.calls[0][1]).toEqual(["vendor", 4, 392]);
});
it("unwraps the actual canonical crew location envelope including an empty authorized result", async () => {
  mocks.request.mockResolvedValueOnce({ locations: [{ ticketId: 100007, employeeName: "Private name", lifecycleState: "on_site", latitude: 35.5, longitude: -97.5, recordedAt: state.configuredAt }] });
  expect(await readDisplayViewRecords({ ...state, view: "crew_map" }, session)).toEqual({ records: [{ id: "ticket:100007", title: "Ticket 100007", status: "on_site", detail: "Reported phone location", latitude: 35.5, longitude: -97.5, sourceRecordedAt: state.configuredAt }], truncated: false });
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith("/live-locations?siteLocationId=392", "GET", {}, session);
  mocks.request.mockResolvedValueOnce({ locations: [] });
  expect(await readDisplayViewRecords({ ...state, view: "crew_map" }, session)).toEqual({ records: [], truncated: false });
});
it("safety projection discards unrelated site rows and room read never joins or captures", async () => {
  mocks.request.mockResolvedValueOnce({ incidents: [{ eventId: id, siteLocationId: 393 }] });
  expect(await readDisplayViewRecords({ ...state, view: "safety" }, session)).toEqual({ records: [], truncated: false });
  mocks.request.mockResolvedValueOnce({ item: { occurrence: { id, status: "scheduled", startsAt: state.configuredAt, endsAt: null }, meeting: { title: "Saved meeting" } } });
  expect(await readDisplayViewRecords({ ...state, view: "meeting_room", siteLocationId: null, meetingOccurrenceId: id }, session)).toMatchObject([{ title: "Saved meeting", status: "scheduled" }]);
  expect(mocks.request.mock.calls.every(call => call[1] === "GET")).toBe(true);
});
