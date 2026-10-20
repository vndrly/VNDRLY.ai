import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ pool: { connect: mocks.connect } }));
import { databaseFleetRepository, emptyFleetState } from "./fleet-repository";
import { FleetRunSchema } from "@workspace/api-zod";
import { createFleetService, type FleetServiceOptions } from "./fleet-ops";
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
  it("applies a stored capability override during legacy operations without persisting projected roles", async () => {
    const fleetId = "e81f62e2-9600-4be4-8f56-41140c0139ea";
    const state = { ...emptyFleetState(), enabled: true, fleets: [{ id: fleetId, name: "Synthetic", siteIds: [], requiredCertifications: [], equipmentAssetIds: [] }], grants: [{ userId: 1, fleetIds: [fleetId], siteIds: [], roles: ["dispatcher"], safetyRelease: false, financeRead: false }] };
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("JOIN users") ? [{ id: 8 }] : sql.includes("SELECT fleet_ops_state") ? [{ fleet_ops_state: state }] : sql.includes("FROM fleet_person_capabilities") ? [{ capabilities: ["office"] }] : [] }));
    const effective = await databaseFleetRepository.transaction(7, 1, async current => current.grants[0]?.roles, authority);
    expect(effective).toEqual([]);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE vendors SET fleet_ops_state"))).toBe(false);
  });
  it("keeps legacy Fleet roles when no stored capability row exists", async () => {
    const fleetId = "e81f62e2-9600-4be4-8f56-41140c0139ea";
    const state = { ...emptyFleetState(), enabled: true, fleets: [{ id: fleetId, name: "Synthetic", siteIds: [], requiredCertifications: [], equipmentAssetIds: [] }], grants: [{ userId: 1, fleetIds: [fleetId], siteIds: [], roles: ["dispatcher"], safetyRelease: false, financeRead: false }] };
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("JOIN users") ? [{ id: 8 }] : sql.includes("SELECT fleet_ops_state") ? [{ fleet_ops_state: state }] : [] }));
    expect(await databaseFleetRepository.transaction(7, 1, async current => current.grants[0]?.roles, authority)).toEqual(["dispatcher"]);
  });
  it("does not let vendor membership Admin bypass a stored Office-only override", async () => {
    const adminAuthority = { ...authority, membershipRole: "admin" };
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("JOIN users") ? [{ id: 8 }] : sql.includes("SELECT fleet_ops_state") ? [{ fleet_ops_state: emptyFleetState() }] : sql.includes("FROM fleet_person_capabilities") ? [{ capabilities: ["office"] }] : [] }));
    const effective = await databaseFleetRepository.transaction(7, 1, async () => adminAuthority.membershipRole, adminAuthority);
    expect(effective).toBe("member");
    expect(adminAuthority.membershipRole).toBe("admin");
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

describe("stored Fleet capabilities through the repository and service", () => {
  const fleetId = "e81f62e2-9600-4be4-8f56-41140c0139ea";
  const runId = "11111111-1111-4111-8111-111111111111";
  const vehicleId = "22222222-2222-4222-8222-222222222222";
  const actor = () => ({ userId: 1, companyId: 7, ...authority });
  function arrange(input: { capabilities: string[] | null; financeRead?: boolean; siteIds?: number[]; fleetIds?: string[]; legacyRoles?: Array<"fleet_manager" | "driver">; runStatus?: "draft" | "dispatched"; ticketSiteId?: number; ownUnplannedCreate?: boolean }) {
    const run = FleetRunSchema.parse({
      id: runId, fleetId, companyId: 7, title: "Own capture", driverUserId: 1,
      vehicleAssetId: vehicleId, trailerAssetId: null, siteIds: [9],
      status: input.runStatus ?? "dispatched", phase: null, version: 1,
      stops: [{ id: "33333333-3333-4333-8333-333333333333", siteId: 9, kind: "pickup", sequence: 0 }],
      loads: [], inspections: [], currentStopId: null, visitedStopIds: [], events: [],
      linkedTicketId: null, allowedActions: [], workOrigin: "driver_unplanned",
    });
    const state = {
      ...emptyFleetState(), enabled: true,
      fleets: [{ id: fleetId, name: "Synthetic", siteIds: [9], requiredCertifications: [], equipmentAssetIds: [] }],
      grants: [{ userId: 1, fleetIds: input.fleetIds ?? [fleetId], siteIds: input.siteIds ?? [9], roles: input.legacyRoles ?? ["fleet_manager", "driver"], safetyRelease: false, financeRead: input.financeRead ?? true }],
      runs: [run],
    };
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
    mocks.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("run->>'driverUserId' AS driver_user_id")) return { rows: [{ driver_user_id: "1" }] };
      if (sql.includes("JOIN users u ON u.id=m.user_id")) return { rows: [{ id: 8 }] };
      if (sql.includes("SELECT fleet_ops_state FROM vendors")) return { rows: [{ fleet_ops_state: state }] };
      if (sql.includes("FROM fleet_person_capabilities")) return { rows: input.capabilities === null ? [] : [{ capabilities: input.capabilities }] };
      if (sql.includes("FROM site_locations s JOIN partner_vendor_relationships")) return { rows: [9, 11].filter(id => params[1] === null || (params[1] as number[]).includes(id)).map(id => ({ id, name: `Site ${id}`, partner_id: 8, is_active: true, relationship_id: id, relationship_status: "approved", fleet_commercial_authority: null })) };
      if (sql.includes("FROM tickets t JOIN site_locations")) return { rows: [{ id: 10, site_location_id: input.ticketSiteId ?? 9, vendor_id: 7, partner_id: 8, status: "initiated", lifecycle_state: "pending_arrival", fleet_plan: null }] };
      if (sql.includes("SELECT count(*)::int AS runs")) return { rows: [{ runs: 0, total: "0" }] };
      if (sql.includes("SELECT id FROM assistant_action_audit WHERE target_type='fleet-run'")) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });
    const operationId = "66666666-6666-4666-8666-666666666666";
    return createFleetService(databaseFleetRepository, input.ownUnplannedCreate ? {
      originalWorkOperationId: operationId,
      billingV2Create: {
        ownUnplanned: true, operationId, timeZone: "America/Chicago",
        intent: { billingSiteId: 9 } as NonNullable<FleetServiceOptions["billingV2Create"]>["intent"],
        capture: { workAt: "2026-10-19T12:00:00Z" } as NonNullable<FleetServiceOptions["billingV2Create"]>["capture"],
      },
    } : {});
  }
  beforeEach(() => vi.clearAllMocks());
  it("denies Driver-only own dispatch and cancel but preserves assigned driving and legacy fallback", async () => {
    const service = arrange({ capabilities: ["driver"] });
    const driver = actor();
    expect((await service.detail(driver, runId)).allowedActions).toContain("acknowledge");
    expect((await service.detail(actor(), runId)).allowedActions).not.toContain("cancel");
    await expect(service.action(actor(), runId, { operationId: "44444444-4444-4444-8444-444444444444", action: "cancel", expectedVersion: 1 })).rejects.toMatchObject({ code: "fleet.action_forbidden" });
    const draftService = arrange({ capabilities: ["driver"], runStatus: "draft" });
    expect((await draftService.detail(actor(), runId)).allowedActions).not.toContain("dispatch");
    await expect(draftService.action(actor(), runId, { operationId: "55555555-5555-4555-8555-555555555555", action: "dispatch", expectedVersion: 1 })).rejects.toMatchObject({ code: "fleet.action_forbidden" });
    const legacy = arrange({ capabilities: null, legacyRoles: ["driver"], runStatus: "draft" });
    expect((await legacy.detail(actor(), runId)).allowedActions).toContain("dispatch");
    expect((await arrange({ capabilities: ["driver", "self_dispatch"], runStatus: "draft" }).detail(actor(), runId)).allowedActions).toEqual(expect.arrayContaining(["dispatch", "cancel"]));
    const creation = arrange({ capabilities: ["driver"], ownUnplannedCreate: true });
    await expect(creation.create(actor(), {
      operationId: "66666666-6666-4666-8666-666666666666", fleetId,
      title: "Unauthorized own capture", driverUserId: 1, vehicleAssetId: vehicleId,
      billing: { mode: "new_ticket", workTypeId: 3, afeNumber: "A1", workDate: "2026-10-19" },
      detailSelection: { version: 2, detailId: "77777777-7777-4777-8777-777777777777", detailVersion: 1, timeZone: "America/Chicago", returnPolicy: "delivery_only" },
      stops: [{ id: "88888888-8888-4888-8888-888888888888", siteId: 9, kind: "pickup", sequence: 0 }],
    })).rejects.toMatchObject({ code: "fleet.dispatch_required" });
  });
  it("retains only authorized Office finance and site context without dispatch", async () => {
    const service = arrange({ capabilities: ["office"] });
    await expect(service.ticketPlan(actor(), 10)).resolves.toMatchObject({ ticketId: 10, siteId: 9 });
    await expect(service.resources(actor())).rejects.toMatchObject({ code: "fleet.dispatch_required" });
    await expect(arrange({ capabilities: ["office"], financeRead: false }).ticketPlan(actor(), 10)).rejects.toMatchObject({ code: "fleet.finance_required" });
    await expect(arrange({ capabilities: ["office"], siteIds: [11] }).ticketPlan(actor(), 10)).rejects.toMatchObject({ code: "fleet.finance_required" });
    await expect(arrange({ capabilities: ["office"], fleetIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }).ticketPlan(actor(), 10)).rejects.toMatchObject({ code: "fleet.finance_required" });
    await expect(arrange({ capabilities: ["office"], ticketSiteId: 11 }).ticketPlan(actor(), 10)).rejects.toMatchObject({ code: "fleet.ticket_site_forbidden" });
  });
});
