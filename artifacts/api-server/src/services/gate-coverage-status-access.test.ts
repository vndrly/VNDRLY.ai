import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), notify: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: {} }));
vi.mock("./gate-attendance", () => ({ createAttendanceException: vi.fn() }));
vi.mock("./gate-notification-events", () => ({ notifyGateSiteEvent: mocks.notify }));
vi.mock("./gate-change-over", () => ({
  ChangeOverError: class extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  },
  changeOverTransaction: (callback: (client: unknown) => unknown) => callback({ query: mocks.query }),
  requireChangeOverAccess: mocks.access,
}));
import { setGateCoverageStatus } from "./gate-coverage-monitor";
import { ChangeOverError } from "./gate-change-over";

describe("Gate coverage status site authorization", () => {
  const session = { userId: 7, role: "vendor", vendorId: 11, membershipRole: "admin", sv: 1 };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ site_id: 392 }], rowCount: 1 });
  });
  it("does not substitute company admin status for denied site access", async () => {
    mocks.access.mockRejectedValue(new ChangeOverError(403, "change_over.forbidden", "Not the Gate contractor"));
    await expect(setGateCoverageStatus(session, { stationId: "station", mode: "closed", reason: "Test" }))
      .rejects.toMatchObject({ status: 403, code: "change_over.forbidden" });
    expect(mocks.query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)\b|user_org_memberships/.test(sql))).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("refuses an assigned operator without supervisor authority", async () => {
    mocks.access.mockResolvedValue({ supervisor: false });
    await expect(setGateCoverageStatus(session, { stationId: "station", mode: "closed", reason: "Test" }))
      .rejects.toMatchObject({ status: 403, code: "change_over.supervisor_required" });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("saves a status change after current site supervisor authorization", async () => {
    mocks.access.mockResolvedValue({ supervisor: true });
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("INSERT INTO")
      ? [{ station_id: "station", mode: "active", paused_until: null, reason: null, changed_at: new Date() }]
      : [{ site_id: 392 }], rowCount: 1 }));
    await expect(setGateCoverageStatus(session, { stationId: "station", mode: "active" }))
      .resolves.toMatchObject({ stationId: "station", mode: "active" });
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), session, 392);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO gate_coverage_status"))).toBe(true);
  });
});
