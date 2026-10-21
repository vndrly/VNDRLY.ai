import { describe, expect, it } from "vitest";
import type { FleetCapability, FleetHomeProjection } from "@workspace/api-zod";
import { createFleetHomeReader } from "./fleet-mobile-home";
import type { FleetActor } from "./fleet-ops";

const actor: FleetActor = { userId: 7, companyId: 3, role: "field_employee", membershipRole: "field_employee", activeMembershipId: 8, sv: 1 };
const run = (id: string, status: "draft" | "dispatched" | "acknowledged" | "in_progress" | "submitted_for_review" | "completed" | "cancelled", driverUserId = 7) => ({ id, status, driverUserId });
const source = (capabilities: FleetCapability[], runs = [run("11111111-1111-4111-8111-111111111111", "draft")]) => ({
  capabilities: async () => new Set(capabilities),
  overview: async () => ({ companyId: 3, enabled: true, runs, fleets: [], generatedAt: "2026-10-20T00:00:00.000Z" }),
  yardOrders: async () => ({ orders: [] }),
  resources: async () => ({ drivers: [], equipment: [] }),
  map: async () => ({ observations: [] }),
  complianceSummary: async () => ({ status: "red" }),
  compliance: async () => ({ score: 30, status: "red", deductions: [] }),
});

describe("Fleet Home modules", () => {
  it("marks independent summary projections as read-only while leaving Compliance snapshot writes enabled", async () => {
    const access = new Map<string, unknown>();
    const read = createFleetHomeReader({
      ...source(["admin", "dispatch", "office", "yard"]),
      overview: async (current) => { access.set("overview", current.repositoryAccess); return source([]).overview(); },
      yardOrders: async (current) => { access.set("yard", current.repositoryAccess); return { orders: [] }; },
      resources: async (current) => { access.set("assets", current.repositoryAccess); return { drivers: [], equipment: [] }; },
      map: async (current) => { access.set("map", current.repositoryAccess); return {}; },
      complianceSummary: async (current) => { access.set("complianceSummary", current.repositoryAccess); return { status: "green" }; },
      compliance: async (current) => { access.set("compliance", current.repositoryAccess); return { status: "green" }; },
    });
    await read(actor, "summary");
    expect(Object.fromEntries(access)).toEqual({ overview: "read", yard: "read", assets: "read", map: "read", complianceSummary: "read" });
    expect(actor.repositoryAccess).toBeUndefined();
  });
  it("shows the Driver's own next run without Dispatch authority", async () => {
    const read = createFleetHomeReader(source(["driver"], [run("11111111-1111-4111-8111-111111111111", "dispatched", 7), run("22222222-2222-4222-8222-222222222222", "draft", 9)]));
    const result = await read(actor, "summary");
    const data = result.data as FleetHomeProjection;
    expect(result.state).toBe("ready");
    expect(data.nextAction).toMatchObject({ kind: "start_run", runId: "11111111-1111-4111-8111-111111111111" });
    expect(data.priorities).toHaveLength(1);
    expect(data.priorities[0].kind).not.toBe("prepare_detail");
  });

  it("collapses one-person all-capability work into one next action", async () => {
    const read = createFleetHomeReader(source(["admin", "office", "dispatch", "yard", "driver", "self_dispatch"]));
    const result = await read(actor, "summary");
    const data = result.data as FleetHomeProjection;
    expect(data.mode).toBe("my_fleet_day");
    expect(data.priorities).toHaveLength(1);
    expect(data.nextAction).toEqual(data.priorities[0]);
  });

  it("summarizes Dispatch and Fleet Readiness without additional home requests", async () => {
    const read = createFleetHomeReader({
      ...source(["admin", "office", "dispatch", "yard"], [
        run("11111111-1111-4111-8111-111111111111", "draft", 7),
        run("22222222-2222-4222-8222-222222222222", "dispatched", 8),
        run("33333333-3333-4333-8333-333333333333", "in_progress", 9),
        run("44444444-4444-4444-8444-444444444444", "completed", 8),
      ]),
      yardOrders: async () => ({ orders: [
        { id: "55555555-5555-4555-8555-555555555555", status: "assigned", assignedToUserId: 7, runId: null },
        { id: "66666666-6666-4666-8666-666666666666", status: "completed", assignedToUserId: 7, runId: null },
      ] }),
      resources: async () => ({
        drivers: [
          { userId: 10, name: "Available Driver", fleetIds: [] },
          { userId: 8, name: "Assigned Driver", fleetIds: [] },
          { userId: 9, name: "Active Driver", fleetIds: [] },
        ],
        equipment: [
          { id: "77777777-7777-4777-8777-777777777777", name: "Ready Truck", category: "truck", status: "available", dispatchable: true },
          { id: "88888888-8888-4888-8888-888888888888", name: "Held Truck", category: "truck", status: "hold", dispatchable: false },
        ],
      }),
      complianceSummary: async () => ({ status: "amber", score: 82 }),
    });
    const data = (await read(actor, "summary")).data as FleetHomeProjection;
    expect(data.metrics).toEqual({
      yardOrders: 1,
      awaitingDispatch: 1,
      activeRuns: 2,
      runHistory: 1,
      availableDrivers: 1,
      yardInventory: 1,
      complianceScore: 82,
      complianceStatus: "amber",
    });
  });

  it("keeps Dispatch ready when Compliance fails and provides scoped conflict recovery", async () => {
    const read = createFleetHomeReader({
      ...source(["dispatch"]),
      complianceSummary: async () => { throw { status: 409, code: "fleet.version_conflict" }; },
      compliance: async () => { throw { status: 409, code: "fleet.version_conflict" }; },
    });
    const result = await read(actor, "summary");
    const data = result.data as FleetHomeProjection;
    expect(result.state).toBe("warning");
    expect(data.moduleStates).toContainEqual({ module: "dispatch", state: "ready" });
    expect(data.moduleStates).toContainEqual({ module: "compliance", state: "unavailable" });
    const compliance = await read(actor, "compliance");
    expect(compliance).toMatchObject({ state: "unavailable", error: { status: 409, code: "fleet.version_conflict", recovery: { module: "compliance", reloadCanonical: true, retainedWork: "unknown" } } });
  });

  it("keeps Driver work ready when the Map module is unavailable", async () => {
    const read = createFleetHomeReader({
      ...source(["admin", "dispatch", "driver"], [run("11111111-1111-4111-8111-111111111111", "in_progress")]),
      map: async () => { throw new Error("map outage"); },
    });
    const result = await read(actor, "summary");
    const data = result.data as FleetHomeProjection;
    expect(data.nextAction).toMatchObject({ kind: "continue_run" });
    expect(data.moduleStates).toContainEqual({ module: "map", state: "unavailable" });
    expect((await read(actor, "map")).state).toBe("unavailable");
  });

  it("keeps an assigned Yard action when the run overview fails", async () => {
    const orderId = "33333333-3333-4333-8333-333333333333";
    const read = createFleetHomeReader({
      ...source(["yard"]),
      overview: async () => { throw new Error("run read unavailable"); },
      yardOrders: async () => ({ orders: [{ id: orderId, status: "assigned", assignedToUserId: 7, runId: null }] }),
    });
    const result = await read(actor, "summary");
    const data = result.data as FleetHomeProjection;
    expect(result.state).toBe("warning");
    expect(data.nextAction).toMatchObject({ kind: "report_yard_order", yardOrderId: orderId });
    expect(data.moduleStates).toContainEqual({ module: "yard", state: "ready" });
    expect(data.moduleStates).toContainEqual({ module: "history", state: "unavailable" });
  });

  it("keeps an active Driver action ahead of a separate Yard follow-up for the same run", async () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    const orderId = "33333333-3333-4333-8333-333333333333";
    const read = createFleetHomeReader({
      ...source(["driver", "yard"], [run(runId, "in_progress")]),
      yardOrders: async () => ({ orders: [{ id: orderId, status: "assigned", assignedToUserId: 7, runId }] }),
    });
    const data = (await read(actor, "summary")).data as FleetHomeProjection;
    expect(data.nextAction).toMatchObject({ kind: "continue_run", runId });
    expect(data.priorities).toContainEqual(expect.objectContaining({ kind: "report_yard_order", runId, yardOrderId: orderId }));
  });

  it("lets an independent self-dispatching Driver complete assigned Yard work without Yard staff", async () => {
    const orderId = "33333333-3333-4333-8333-333333333333";
    const read = createFleetHomeReader({
      ...source(["driver", "self_dispatch"], []),
      yardOrders: async () => ({ orders: [{ id: orderId, status: "assigned", assignedToUserId: 7, runId: null }] }),
    });
    const data = (await read(actor, "summary")).data as FleetHomeProjection;
    expect(data.mode).toBe("my_fleet_day");
    expect(data.nextAction).toMatchObject({ kind: "report_yard_order", yardOrderId: orderId });
  });
});
