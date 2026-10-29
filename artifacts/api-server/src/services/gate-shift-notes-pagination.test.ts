import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: mock }));
import { getShiftNotes } from "./gate-change-over";
const timestamp = "2026-10-27T12:00:00Z";
const rows = Array.from({ length: 51 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(99-i).padStart(12,"0")}`, acknowledged_at: timestamp, summary: { facts: [] }, snapshot: { facts: [], openItems: [] } }));
beforeEach(() => {
  mock.query.mockReset(); mock.query.mockImplementation(async (sql: string) => ({ rows: sql === "SELECT * FROM gate_stations WHERE id=$1" ? [{ site_id: 10 }] : sql.startsWith("SELECT id, role, session_version") ? [{ id: 1, role: "admin", session_version: 1 }] : sql.startsWith("SELECT id, name, partner_id") ? [{ id: 10 }] : sql.includes("FROM gate_handovers h JOIN gate_preparations") ? rows : [] }));
});
it("returns a tie-breaking identity for notes sharing the same acknowledgement time", async () => {
  const result = await getShiftNotes({ userId: 1, role: "admin", sv: 1 }, { stationId: "gate", days: 30 });
  expect(result.rows).toHaveLength(50); expect(result.nextBeforeId).toBe(rows[49].id);
  expect(result.nextBefore).toBe(new Date(timestamp).toISOString());
});
it("applies the identity cursor while retaining station authorization and the 30-day window", async () => {
  await getShiftNotes({ userId: 1, role: "admin", sv: 1 }, { stationId: "gate", days: 30, before: timestamp, beforeId: rows[49].id });
  const [sql, params] = mock.query.mock.calls.find(([sql]) => sql.includes("FROM gate_handovers h JOIN gate_preparations"))!;
  expect(sql).toContain("h.acknowledged_at=$3 AND h.id<$8"); expect(params[7]).toBe(rows[49].id); expect(params[0]).toBe("gate");
});
