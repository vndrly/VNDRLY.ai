import { beforeEach, expect, it, vi } from "vitest";

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query, connect } }));
vi.mock("./gate-notification-events", () => ({ notifyGateSiteEvent: vi.fn() }));
import { listGateRecoveryOperators, recoverGateShift } from "./gate-change-over";

const supervisor = { userId: 1, role: "admin", sv: 1 };
const candidates = [2, 3].map(userId => ({ user_id: userId, membership_id: userId * 10, vendor_id: 7,
  vendor_people_id: null, role: "admin", session_version: 1, name: `Operator ${userId}`, company_name: "Company" }));

beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    let rows: unknown[];
    if (sql.startsWith("SELECT * FROM gate_stations")) rows = [{ id: "gate", site_id: 42 }];
    else if (sql.startsWith("SELECT id, role, session_version")) rows = [{ id: values[0], role: values[0] === 1 ? "admin" : "vendor", session_version: 1 }];
    else if (sql.startsWith("SELECT id, name, partner_id")) rows = [{ id: 42, name: "Site", partner_id: 5 }];
    else if (sql.includes("SELECT m.id AS membership_id")) rows = candidates;
    else if (sql.startsWith("SELECT DISTINCT operator_id")) rows = [{ operator_id: 3 }];
    else if (sql.startsWith("SELECT id FROM site_work_assignments")) rows = [{ id: 1 }];
    else if (sql.startsWith("SELECT id, vendor_people_id, role FROM user_org_memberships")) rows = [{ id: 20, role: "admin" }];
    else if (sql.startsWith("SELECT s.*, u.display_name")) rows = [{ id: "outgoing-watch", operator_id: 9 }];
    else if (sql.startsWith("SELECT id FROM gate_shifts WHERE operator_id")) rows = [{ id: "other-watch" }];
    else if (sql.startsWith("SELECT s.*,p.summary")) rows = [];
    else if (sql === "BEGIN" || sql === "ROLLBACK" || sql.startsWith("SET LOCAL") || sql.startsWith("LOCK TABLE") || sql.startsWith("SELECT id FROM gate_stations")) rows = [];
    else throw new Error(`Unexpected query: ${sql}`);
    return { rows, rowCount: rows.length };
  });
  connect.mockResolvedValue({ query, release: vi.fn() });
});

it("offers authorized operators with no current watch and excludes busy operators", async () => {
  const result = await listGateRecoveryOperators(supervisor, "gate");
  expect(result.operators.map(operator => operator.userId)).toEqual([2]);
  expect(result.operators[0]).not.toHaveProperty("session");
  expect(query).toHaveBeenCalledWith(expect.stringContaining("ended_at IS NULL AND operator_id=ANY"), [[2, 3]]);
});

it("rechecks availability before recovery and refuses an operator already on watch", async () => {
  await expect(recoverGateShift(supervisor, "gate", "outgoing-watch", "Operator unavailable", 20))
    .rejects.toMatchObject({ status: 409, code: "change_over.operator_on_watch" });
  expect(query.mock.calls.some(([sql]) => /INSERT INTO|UPDATE gate_shifts/.test(sql))).toBe(false);
});

it("also refuses self-assumption when the supervisor already has a watch", async () => {
  await expect(recoverGateShift(supervisor, "gate", "outgoing-watch", "Operator unavailable"))
    .rejects.toMatchObject({ status: 409, code: "change_over.operator_on_watch" });
  expect(query.mock.calls.some(([sql]) => /INSERT INTO|UPDATE gate_shifts/.test(sql))).toBe(false);
});
