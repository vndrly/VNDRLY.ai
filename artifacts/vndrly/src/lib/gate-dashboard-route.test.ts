import { describe, expect, it } from "vitest";
import { gateDashboardRouteFor } from "./gate-dashboard-route";

describe("gate dashboard landing", () => {
  it("lands gatekeepers and gate supervisors on Dashboard", () => {
    expect(gateDashboardRouteFor({ role: "vendor", vendorRole: "gatekeeper" })).toBe("/gate/change-over");
    expect(gateDashboardRouteFor({ role: "vendor", vendorRole: "gate_supervisor" })).toBe("/gate/change-over");
  });

  it("does not change the landing for other users", () => {
    expect(gateDashboardRouteFor({ role: "vendor", vendorRole: "admin" })).toBe("/");
    expect(gateDashboardRouteFor({ role: "admin", vendorRole: null })).toBe("/");
  });
});

it("lands every active GateGo membership on Gate Dashboard without changing other companies", () => {
  for (const role of ["admin", "office", "field", "gatekeeper", "gate_supervisor"]) {
    const user = {role: "vendor", vendorRole: role, activeMembershipId: 7, availableMemberships: [{id: 7, orgId: 20, orgType: "vendor", orgName: "GateGo"}]};
    expect(gateDashboardRouteFor(user)).toBe("/gate/change-over");
    expect(gateDashboardRouteFor({...user, vendorRole: "office", activeMembershipId: 8, availableMemberships: [...user.availableMemberships, {id: 8, orgId: 21, orgType: "vendor", orgName: "Other"}]})).toBe("/");
  }
});
