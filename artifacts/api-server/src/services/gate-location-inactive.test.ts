import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  shift: null as any,
  duty: null as any,
  query: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: any[]) => state.query(...args),
    connect: async () => ({
      query: (...args: any[]) => state.query(...args),
      release() {},
    }),
  },
}));
vi.mock("./gate-notification-events", () => ({
  notifyGateSiteEvent: async () => {},
}));
import { listChangeOverStations, listChangeOverSites, startGateShift } from "./gate-change-over";
import { assumeGateDuty, endGateDuty, startWorkSession } from "./gate-duty";
const session = { userId: 7, role: "admin", sv: 1 };
beforeEach(() => {
  state.shift = null;
  state.duty = null;
  state.query.mockImplementation(async (sql: string, p: any[] = []) => {
    let rows: any[] = [];
    if (sql.includes("FROM gate_stations"))
      rows = [{ id: "gate", site_id: 22, name: "Closed gate", active: false }];
    else if (sql.includes("FROM users"))
      rows = [{ id: 7, role: "admin", session_version: 1 }];
    else if (sql.includes("FROM site_locations"))
      rows = [{ id: 22, partner_id: 41 }];
    else if (sql.includes("FROM work_hub_shifts"))
      rows = [
        {
          id: "scheduled",
          site_location_id: 22,
          gate_station_id: "gate",
          work_start_policy: "paid_travel",
        },
      ];
    else if (sql.includes("FROM gate_shifts"))
      rows = state.shift ? [state.shift] : [];
    else if (sql.includes("count(*)")) rows = [{ count: 0 }];
    else if (sql.includes("FROM gate_duty_sessions"))
      rows = state.duty ? [state.duty] : [];
    else if (sql.startsWith("UPDATE gate_duty_sessions")) {
      state.duty = { ...state.duty, ended_at: p[1] };
      rows = [state.duty];
    } else if (sql.startsWith("INSERT INTO gate_shifts"))
      rows = [{ id: "new-shift" }];
    else if (sql.includes("INSERT INTO gate_duty_sessions"))
      rows = [{ id: "new-duty" }];
    else if (sql.includes("INSERT INTO gate_work_sessions"))
      rows = [{ id: "new-work" }];
    return { rows, rowCount: rows.length };
  });
});
it("discovers inactive gates for authorized history reads without adding them to new-use discovery", async () => {
  const base = state.query.getMockImplementation()!;
  state.query.mockImplementation(async (sql: string, p: any[] = []) => {
    if (sql.includes("FROM gate_stations") && !sql.includes("WHERE id=$1")) {
      return { rows: sql.includes("station.active=true") ? [] : [{ id: "gate", name: "Closed gate", site_id: 22 }], rowCount: 1 };
    }
    return base(sql, p);
  });
  expect(await listChangeOverStations(session, 22)).toEqual([]);
  expect(await listChangeOverStations(session, 22, "history")).toMatchObject([{ id: "gate" }]);
});
it("lets history find an authorized site with no current scheduled or active shift", async () => {
  const base = state.query.getMockImplementation()!;
  state.query.mockImplementation(async (sql: string, p: any[] = []) => {
    if (sql.startsWith("SELECT s.id, s.name")) return { rows: p[4] === true ? [{ id: 22, name: "Former gate site" }] : [], rowCount: p[4] ? 1 : 0 };
    return base(sql, p);
  });
  expect(await listChangeOverSites(session)).toEqual([]);
  expect(await listChangeOverSites(session, "history")).toMatchObject([{ id: 22 }]);
});
it("rejects a new legacy shift at an inactive gate", async () => {
  await expect(startGateShift(session, "gate")).rejects.toMatchObject({
    code: "change_over.station_inactive",
  });
});
it("still requires current site authorization for historical gate discovery", async () => {
  const base = state.query.getMockImplementation()!;
  state.query.mockImplementation(async (sql: string, p: any[] = []) => sql.includes("FROM site_locations") ? { rows: [], rowCount: 0 } : base(sql, p));
  await expect(listChangeOverStations(session, 22, "history")).rejects.toMatchObject({ code: "change_over.forbidden" });
});
it("rejects new duty and paid travel at an inactive gate", async () => {
  await expect(
    assumeGateDuty(session, {
      stationId: "gate",
      source: "ios",
      idempotencyKey: "new",
    }),
  ).rejects.toMatchObject({ code: "change_over.station_inactive" });
  await expect(
    startWorkSession(session, {
      workHubShiftId: "scheduled",
      source: "ios",
      idempotencyKey: "new",
    }),
  ).rejects.toMatchObject({ code: "change_over.station_inactive" });
});
it("lets the current operator recover the active shift and finish handoff/sign-out after deactivation", async () => {
  state.shift = { id: "shift", operator_id: 7 };
  state.duty = {
    id: "duty",
    station_id: "gate",
    user_id: 7,
    started_at: new Date(),
    ended_at: null,
  };
  expect(await startGateShift(session, "gate")).toMatchObject({ id: "shift" });
  const ended = await endGateDuty(session, {
    dutySessionId: "duty",
    reason: "Closed gate",
    handoffCompleted: true,
  });
  expect(ended.endedAt).toBeInstanceOf(Date);
});
