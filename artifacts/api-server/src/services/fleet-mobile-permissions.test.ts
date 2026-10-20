import { describe, expect, it } from "vitest";
import type { FleetCapability } from "@workspace/api-zod";
import { legacyFleetCapabilities, mayPerformFleetMobileAction, projectFleetMobileActions } from "./fleet-mobile-permissions";

const companyId = 19;
const fleetId = "e81f62e2-9600-4be4-8f56-41140c0139ea";
const grant = { companyId, fleetIds: [fleetId], siteIds: [7], roles: ["driver"] as const, safetyRelease: false, financeRead: false };
const target = { companyId, fleetId, siteId: 7, driverUserId: 42, assignedToUserId: 42 };
function actor(capabilities: FleetCapability[]) {
  return { userId: 42, companyId, capabilities: new Set(capabilities), grant };
}

describe("composable Fleet authority", () => {
  it.each([
    [["admin"], ["configure", "office_review", "dispatch", "yard_work", "view_live_map", "view_compliance"]],
    [["office"], ["office_review", "view_compliance"]],
    [["dispatch"], ["dispatch", "view_live_map", "view_compliance"]],
    [["yard"], ["yard_work"]],
    [["driver"], ["perform_run"]],
    [["driver", "yard"], ["yard_work", "perform_run"]],
    [["driver", "self_dispatch"], ["perform_run", "self_dispatch"]],
  ] as const)("allows exactly the actions of %j", (capabilities, allowed) => {
    const all = ["configure", "office_review", "dispatch", "yard_work", "perform_run", "self_dispatch", "view_live_map", "view_compliance"] as const;
    expect(all.filter(action => mayPerformFleetMobileAction(actor([...capabilities]), target, action))).toEqual(allowed);
  });

  it("collapses an independent operator's handoff to one authority", () => {
    const all: FleetCapability[] = ["admin", "office", "dispatch", "yard", "driver", "self_dispatch"];
    expect(projectFleetMobileActions(actor(all), target)).toEqual([
      "configure", "office_review", "dispatch", "yard_work", "perform_run", "self_dispatch", "view_live_map", "view_compliance",
    ]);
  });

  it("denies cross-company, out-of-fleet, out-of-site, and unassigned work", () => {
    const a = actor(["admin", "yard", "driver"]);
    expect(mayPerformFleetMobileAction(a, { ...target, companyId: 20 }, "configure")).toBe(false);
    expect(mayPerformFleetMobileAction(a, { ...target, fleetId: "other" }, "configure")).toBe(false);
    expect(mayPerformFleetMobileAction(a, { ...target, siteId: 8 }, "yard_work")).toBe(false);
    expect(mayPerformFleetMobileAction(a, { ...target, driverUserId: 43 }, "perform_run")).toBe(false);
    expect(mayPerformFleetMobileAction({ ...a, grant: null }, target, "configure")).toBe(false);
  });

  it("maps only the three legacy Fleet roles", () => {
    expect([...legacyFleetCapabilities(["fleet_manager"])]).toEqual(["admin", "dispatch"]);
    expect([...legacyFleetCapabilities(["dispatcher"])]).toEqual(["dispatch"]);
    expect([...legacyFleetCapabilities(["driver"])]).toEqual(["driver"]);
    expect([...legacyFleetCapabilities(["driver", "dispatcher"])]).toEqual(["dispatch", "driver"]);
    expect([...legacyFleetCapabilities(["unknown"])]).toEqual([]);
  });
});
