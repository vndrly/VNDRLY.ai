import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ pool: { connect: mocks.connect } }));
import { databaseFleetRepository, emptyFleetState } from "./fleet-repository";
const authority = {
  sv: 2,
  activeMembershipId: 8,
  membershipRole: "member",
  role: "vendor",
};
describe("Fleet repository current session and atomic persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("JOIN users")
        ? [{ id: 8 }]
        : sql.includes("SELECT fleet_ops_state")
          ? [{ fleet_ops_state: emptyFleetState() }]
          : [],
    }));
  });
  it("refuses absent authority before any callback and rolls back", async () => {
    const callback = vi.fn();
    await expect(
      databaseFleetRepository.transaction(7, 1, callback),
    ).rejects.toMatchObject({ code: "fleet.current_session_required" });
    expect(callback).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("binds current version, exact membership and suspension check", async () => {
    await databaseFleetRepository.transaction(
      7,
      1,
      async () => "read",
      authority,
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "u.session_version=$5 AND u.suspended_at IS NULL FOR SHARE",
      ),
      [1, 7, 8, "member", 2],
    );
    expect(mocks.query).toHaveBeenCalledWith("COMMIT");
  });
  it("refuses removed membership or changed version without entering domain logic", async () => {
    mocks.query.mockImplementation(async () => ({ rows: [] }));
    const callback = vi.fn();
    await expect(
      databaseFleetRepository.transaction(7, 1, callback, authority),
    ).rejects.toMatchObject({ code: "fleet.membership_required" });
    expect(callback).not.toHaveBeenCalled();
  });
  it("requires a current active same-company person for field sessions", async () => {
    const callback = vi.fn();
    await expect(
      databaseFleetRepository.transaction(7, 1, callback, {
        ...authority,
        role: "field_employee",
        membershipRole: "field_employee",
        vendorPeopleId: 19,
      }),
    ).rejects.toMatchObject({ code: "fleet.current_person_required" });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("deleted_at IS NULL FOR SHARE"),
      [19, 1, 7],
    );
    expect(callback).not.toHaveBeenCalled();
  });
  it("rolls back callback failure and never retries an unknown commit failure", async () => {
    await expect(
      databaseFleetRepository.transaction(
        7,
        1,
        async () => {
          throw new Error("domain rejected");
        },
        authority,
      ),
    ).rejects.toThrow("domain rejected");
    expect(mocks.query).not.toHaveBeenCalledWith("COMMIT");
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql === "COMMIT") throw new Error("unknown commit");
      return {
        rows: sql.includes("JOIN users")
          ? [{ id: 8 }]
          : sql.includes("SELECT fleet_ops_state")
            ? [{ fleet_ops_state: emptyFleetState() }]
            : [],
      };
    });
    const callback = vi.fn(async () => "accepted");
    await expect(
      databaseFleetRepository.transaction(7, 1, callback, authority),
    ).rejects.toThrow("unknown commit");
    expect(callback).toHaveBeenCalledOnce();
  });
});
