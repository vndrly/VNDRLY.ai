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
