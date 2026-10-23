import { expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { connect: async () => ({ query, release: vi.fn() }) } }));
vi.mock("./gate-notification-events", () => ({ notifyGateSiteEvent: vi.fn() }));
import { getChangeOverState } from "./gate-change-over";

it("returns real site activity before a watch exists without starting or assigning one", async () => {
  const now = Date.now();
  query.mockImplementation(async (sql: string) => {
    let rows: unknown[] = [];
    if (sql.startsWith("SELECT * FROM gate_stations")) rows = [{ id: "gate", site_id: 42 }];
    else if (sql.startsWith("SELECT id, role, session_version")) rows = [{ id: 1, role: "admin", session_version: 1 }];
    else if (sql.startsWith("SELECT id, name, partner_id")) rows = [{ id: 42, name: "Site", partner_id: 5 }];
    else if (sql.includes("FROM site_visits WHERE")) rows = [{ id: "visit:1", kind: "visitor", name: "Visitor", company: "Company", plate: "OK:123",
      checkIn: new Date(now - 2 * 60 * 60_000).toISOString(), checkOut: null, admission: "approved", expectedMinutes: 60, reconciliation: "not_required", notes: null }];
    return { rows, rowCount: rows.length };
  });
  const state = await getChangeOverState({ userId: 1, role: "admin", sv: 1 }, "gate");
  expect(state.shift).toBeNull();
  expect(state.preparation).toBeNull();
  expect(state.snapshot?.metrics).toMatchObject({ checkIns: 1, onSiteVisitorRecords: 1, onSiteVehicles: 1 });
  expect(Date.parse(state.snapshot!.startedAt)).toBeGreaterThanOrEqual(now - 24 * 60 * 60_000);
  expect(query.mock.calls.some(([sql]) => /INSERT INTO|UPDATE |DELETE FROM/.test(sql))).toBe(false);
});
