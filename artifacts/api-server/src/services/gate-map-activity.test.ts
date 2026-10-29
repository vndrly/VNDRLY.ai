import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { connect: async () => ({ query: mock.query, release: mock.release }) } }));
import { readGateMapActivity } from "./gate-change-over";
const session = { userId: 1, role: "vendor", vendorId: 2, activeMembershipId: 3, membershipRole: "admin", sv: 2 } as any;
const now = Date.now(), start = new Date(now - 3600000);
const rows = [
  { id: "visit:1", kind: "visitor", name: "A", checkIn: new Date(now - 1800000), checkOut: null, admission: "approved", reconciliation: "not_required", expectedMinutes: 60 },
  { id: "visit:2", kind: "visitor", name: "B", checkIn: new Date(now - 1800000), checkOut: null, admission: "pending", reconciliation: "needs_review" },
  { id: "checkin:3", kind: "employee", name: "C", checkIn: new Date(now - 1800000), checkOut: new Date(now - 600000), admission: null },
];
beforeEach(() => {
  vi.clearAllMocks();
  mock.query.mockImplementation(async (sql: string, values: any[]) => {
    let data: any[] = [];
    if (sql === "SELECT * FROM gate_stations WHERE id=$1") data = [{ id: values[0], site_id: 10, name: "Main Gate" }];
    else if (sql.includes("FROM users WHERE id=$1")) data = [{ id: 1, role: "vendor", session_version: 2 }];
    else if (sql.includes("SELECT id, name, partner_id")) data = [{ id: 10, name: "Site A" }];
    else if (sql.includes("FROM site_work_assignments")) data = [{ id: 1 }];
    else if (sql.includes("SELECT id, vendor_people_id, role")) data = [{ id: 3, role: "admin" }];
    else if (sql.includes("ended_at IS NULL") && sql.includes("gate_shifts")) data = [{ started_at: start }];
    else if (sql.includes("FROM site_visits WHERE")) data = rows;
    return { rows: data, rowCount: data.length };
  });
});
it("uses dashboard definitions with explicit visitor/GPS and employee gate attribution, without returning people", async () => {
  const result = await readGateMapActivity(session, "gate-a");
  expect(result).toMatchObject({ stationId: "gate-a", siteId: 10, scope: "gate_attributed", window: "current_shift", metrics: { checkIns: 2, checkOuts: 1, pendingAdmission: 1, itemsToReview: 1 } });
  const [sql, values] = mock.query.mock.calls.find(([sql]) => sql.includes("FROM site_visits WHERE"))!;
  expect(values).toEqual([10, start, "gate-a"]);
  expect(sql).toContain("coalesce(gate_station_id::text,check_in_gps_evidence->>'gateStationId')=$3");
  expect(sql).toContain("c.gate_station_id::text=$3");
  expect(result).not.toHaveProperty("records");
  expect(mock.query).toHaveBeenCalledWith("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
});
it("rejects a stale session before reading activity", async () => {
  await expect(readGateMapActivity({ ...session, sv: 99 }, "gate-a")).rejects.toMatchObject({ status: 401 });
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("FROM site_visits WHERE"))).toBe(false);
});
it("rejects a different active membership before reading activity", async () => {
  const original = mock.query.getMockImplementation()!;
  mock.query.mockImplementation(async (sql: string, values: any[]) => sql.includes("SELECT id, vendor_people_id, role") ? { rows: [], rowCount: 0 } : original(sql, values));
  await expect(readGateMapActivity({ ...session, activeMembershipId: 99 }, "gate-a")).rejects.toMatchObject({ status: 403 });
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("FROM site_visits WHERE"))).toBe(false);
});
it("uses another clicked gate and does not silently default to a site selector", async () => {
  await readGateMapActivity(session, "gate-b");
  expect(mock.query.mock.calls.find(([sql]) => sql.includes("FROM site_visits WHERE"))?.[1][2]).toBe("gate-b");
});
