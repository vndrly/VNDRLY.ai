import { beforeEach, expect, it, vi } from "vitest";
const connect = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({ pool: { connect } }));
vi.mock("./gate-notification-events", () => ({ notifyGateSiteEvent: vi.fn() }));
import { addChangeOverStation } from "./gate-change-over";
const session = { userId: 7, role: "admin", sv: 1 };
const query = vi.fn(), release = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  connect.mockResolvedValue({ query, release });
  query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT id, role, session_version")) return { rows: [{ id: 7, role: "admin", session_version: 1 }] };
    if (sql.startsWith("SELECT id, name, partner_id")) return { rows: [{ id: 10, name: "Site", partner_id: 2 }] };
    if (sql.startsWith("INSERT INTO gate_stations")) return { rows: [{ id: "created", latitude: 35.1, longitude: -97.2 }] };
    return { rows: [], rowCount: 0 };
  });
});
it("stores a gate's coordinates atomically after current management authority passes", async () => {
  expect(await addChangeOverStation(session, 10, "West gate", { latitude: 35.1, longitude: -97.2 })).toMatchObject({ id: "created", latitude: 35.1, longitude: -97.2 });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT(site_id,name) DO NOTHING"), [10, "West gate", 35.1, -97.2]);
  expect(query).toHaveBeenLastCalledWith("COMMIT");
});
it("rejects a duplicate create rather than overwriting an existing gate's coordinates", async () => {
  const original = query.getMockImplementation()!;
  query.mockImplementation(async (sql: string, values?: unknown[]) => sql.startsWith("INSERT INTO gate_stations") ? { rows: [] } : original(sql, values));
  await expect(addChangeOverStation(session, 10, "West gate", { latitude: 35.1, longitude: -97.2 })).rejects.toMatchObject({ status: 409, code: "change_over.gate_already_exists" });
  expect(query).toHaveBeenLastCalledWith("ROLLBACK");
});
it("rejects invalid coordinates and refuses an unauthorized gatekeeper", async () => {
  await expect(addChangeOverStation(session, 10, "West gate", { latitude: 99, longitude: -97 })).rejects.toMatchObject({ status: 400 });
  expect(connect).not.toHaveBeenCalled();
  await expect(addChangeOverStation({ ...session, role: "field_employee", vendorId: 2 }, 10, "West gate", { latitude: 35, longitude: -97 })).rejects.toMatchObject({ status: 403 });
  expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
});
