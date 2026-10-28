import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: mocks }));
vi.mock("./gate-notification-events", () => ({ notifyGateSiteEvent: vi.fn() }));
import { listGateStationManagementStations, moveGateStation, retireGateStation } from "./gate-change-over";
const session = { userId: 7, role: "vendor", vendorId: 2, activeMembershipId: 8, membershipRole: "member", vendorRole: "office", sv: 1 };
const input = { stationId: "gate", siteId: 10, name: "West gate", location: { latitude: 35.4, longitude: -97.2 }, expectedVersion: 3, operationId: "operation" };
let version: number, updates: number, metadata: any, authorized: boolean, activeWatch: boolean;
beforeEach(() => {
  vi.clearAllMocks(); version = 3; updates = 0; metadata = null; authorized = true; activeWatch = false;
  mocks.connect.mockResolvedValue({ query: mocks.query, release: vi.fn() });
  mocks.query.mockImplementation(async (sql: string, params: any[] = []) => {
    let rows: any[] = [];
    if (sql.startsWith("SELECT id, role, session_version")) rows = [{ id: 7, role: "vendor", session_version: 1 }];
    else if (sql.startsWith("SELECT id, name, partner_id")) rows = [{ id: 10, name: "Site", partner_id: 4 }];
    else if (sql.startsWith("SELECT 1 FROM users u")) rows = authorized ? [{ allowed: true }] : [];
    else if (sql.startsWith("SELECT g.id,g.site_id")) rows = [{ id: "gate", siteId: 10, name: "West gate", latitude: 35.1, longitude: -97.2, version, partnerId: 4 }];
    else if (sql.startsWith("SELECT metadata FROM work_hub_audit_log")) rows = metadata ? [{ metadata }] : [];
    else if (sql.startsWith("SELECT 1 FROM gate_shifts")) rows = activeWatch ? [{ active: true }] : [];
    else if (sql.startsWith("UPDATE gate_stations SET active=false")) { updates += 1; version += 1; rows = [{ id: "gate", siteId: 10, name: "West gate", latitude: 35.1, longitude: -97.2, version, active: false }]; }
    else if (sql.startsWith("UPDATE gate_stations")) { updates += 1; version += 1; rows = [{ id: "gate", siteId: 10, name: params[2], latitude: params[3], longitude: params[4], version, active: true }]; }
    else if (sql.startsWith("INSERT INTO work_hub_audit_log")) metadata = JSON.parse(params[7]);
    else if (sql.startsWith('SELECT id,site_id AS "siteId"')) rows = [{ id: "gate", siteId: 10, name: "West gate", version }];
    return { rows, rowCount: rows.length };
  });
});
it("allows office staff to list and move a gate with audited before and after coordinates", async () => {
  expect(await listGateStationManagementStations(session, 10)).toHaveLength(1);
  expect(await moveGateStation(session, input)).toMatchObject({ id: "gate", latitude: 35.4, version: 4 });
  expect(metadata).toMatchObject({ before: { latitude: 35.1, longitude: -97.2 }, result: { latitude: 35.4, longitude: -97.2 } });
  expect(mocks.query).toHaveBeenLastCalledWith("COMMIT");
  expect(mocks.query.mock.calls.some(([sql]) => /UPDATE (site_locations|gate_shifts|gate_duty_sessions)/.test(sql))).toBe(false);
});
it("replays a saved receipt without moving the gate again", async () => {
  const result = await moveGateStation(session, input);
  expect(await moveGateStation(session, input)).toEqual(result);
  expect(updates).toBe(1);
});
it("rejects stale versions without overwriting the current gate", async () => {
  version = 4;
  await expect(moveGateStation(session, input)).rejects.toMatchObject({ status: 409, code: "change_over.gate_version_conflict" });
  expect(updates).toBe(0);
  expect(mocks.query).toHaveBeenLastCalledWith("ROLLBACK");
});
it("denies unauthorized gatekeepers and rechecks authorization before retrying a receipt", async () => {
  await moveGateStation(session, input);
  authorized = false;
  await expect(moveGateStation({ ...session, vendorRole: "gatekeeper" }, input)).rejects.toMatchObject({ status: 403 });
  await expect(listGateStationManagementStations(session, 10)).rejects.toMatchObject({ status: 403 });
  expect(updates).toBe(1);
});
it("retires a gate idempotently while retaining its identity, coordinates and history", async () => {
  const { stationId, siteId, expectedVersion, operationId } = input;
  const command = { stationId, siteId, expectedVersion, operationId };
  const result = await retireGateStation(session, command);
  expect(result).toMatchObject({ id: "gate", active: false, latitude: 35.1, longitude: -97.2 });
  expect(await retireGateStation(session, command)).toEqual(result);
  expect(updates).toBe(1);
  expect(metadata.before).toMatchObject({ id: "gate", latitude: 35.1 });
  expect(mocks.query.mock.calls.some(([sql]) => /\b(DELETE|DROP|TRUNCATE)\b/.test(sql))).toBe(false);
});
it("refuses to retire a gate while a watch is active", async () => {
  activeWatch = true;
  await expect(retireGateStation(session, input)).rejects.toMatchObject({ code: "change_over.gate_in_use", status: 409 });
  expect(updates).toBe(0);
  expect(mocks.query).toHaveBeenLastCalledWith("ROLLBACK");
});
