import { describe, expect, it } from "vitest";
import type { FleetRun } from "@workspace/api-zod";
import { fleetActionInput, fleetHomeRoute } from "./fleet-mobile";

describe("Fleet mobile action contract", () => {
  it("honors only explicit saved home with current corresponding server capability", () => {
    const overview = { enabled: true, capabilities: { canDispatch: false, canDrive: true, canManage: false, canSetup: false }, preference: { userId: 1, version: 2, defaultWorkspace: "fleet_my_day" as const, selectedFleetId: null } };
    expect(fleetHomeRoute(overview)).toBe("/(tabs)/fleet?view=my-day");
    expect(fleetHomeRoute({ ...overview, capabilities: { ...overview.capabilities, canDrive: false } })).toBeNull();
    expect(fleetHomeRoute({ ...overview, preference: { ...overview.preference, defaultWorkspace: "standard" } })).toBeNull();
    expect(fleetHomeRoute({ ...overview, enabled: false })).toBeNull();
  });
  const run = { version: 7, allowedActions: ["acknowledge"] } as FleetRun;
  it("binds an action to the exact server revision and operation", () => {
    expect(fleetActionInput(run, "acknowledge", "operation", { expectedVersion: 2 })).toEqual({ action: "acknowledge", operationId: "operation", expectedVersion: 7 });
  });
  it("refuses actions absent from current authorized run", () => {
    expect(() => fleetActionInput(run, "dispatch", "operation")).toThrow("unavailable");
  });
});
