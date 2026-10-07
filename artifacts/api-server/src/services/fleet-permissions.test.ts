import { describe, expect, it } from "vitest";
import { mayPerformFleetAction, type FleetGrant } from "./fleet-permissions";

const target = { companyId: 7, fleetId: "fleet-a", siteId: 9, driverUserId: 91 };
const grant: FleetGrant = { companyId: 7, fleetIds: ["fleet-a"], siteIds: [9], roles: ["fleet_manager"], safetyRelease: false, financeRead: false };

describe("Fleet role and assignment permissions", () => {
  it("includes dispatch for a scoped manager", () => {
    expect(mayPerformFleetAction(12, grant, target, "dispatch")).toBe(true);
    expect(mayPerformFleetAction(12, grant, target, "manage_maintenance")).toBe(true);
  });
  it("keeps dispatcher operations narrower than management", () => {
    const dispatcher: FleetGrant = { ...grant, roles: ["dispatcher"], safetyRelease: true, financeRead: true };
    expect(mayPerformFleetAction(12, dispatcher, target, "dispatch")).toBe(true);
    for (const action of ["manage_assets", "manage_maintenance", "release_safety", "view_finance"] as const) {
      expect(mayPerformFleetAction(12, dispatcher, target, action)).toBe(false);
    }
  });
  it("limits drivers to their own run", () => {
    const driver: FleetGrant = { ...grant, roles: ["driver"] };
    expect(mayPerformFleetAction(91, driver, target, "perform_run")).toBe(true);
    expect(mayPerformFleetAction(12, driver, target, "view")).toBe(false);
    expect(mayPerformFleetAction(91, driver, target, "dispatch")).toBe(false);
  });
  it("denies cross-company, unassigned fleet and unassigned site access", () => {
    for (const other of [{ ...target, companyId: 8 }, { ...target, fleetId: "fleet-b" }, { ...target, siteId: 10 }]) {
      expect(mayPerformFleetAction(12, grant, other, "view")).toBe(false);
    }
    expect(mayPerformFleetAction(12, null, target, "view")).toBe(false);
    expect(mayPerformFleetAction(12, { ...grant, roles: [] }, target, "view")).toBe(false);
  });
  it("requires separate safety and finance grants", () => {
    expect(mayPerformFleetAction(12, grant, target, "release_safety")).toBe(false);
    expect(mayPerformFleetAction(12, grant, target, "view_finance")).toBe(false);
    expect(mayPerformFleetAction(12, { ...grant, safetyRelease: true }, target, "release_safety")).toBe(true);
    expect(mayPerformFleetAction(12, { ...grant, financeRead: true }, target, "view_finance")).toBe(true);
  });
});
