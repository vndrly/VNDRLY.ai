import { describe, expect, it } from "vitest";
import { FleetDispatchPlanInputSchema, FleetDispatchPlanSchema } from "./fleet-dispatch-plan";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const location = { type: "provisional" as const, localId: id(4), name: "Job", address: "Job", latitude: null, longitude: null, capturedAt: "2026-10-20T12:00:00Z" };
const route = { origin: location, stops: [{ id: id(5), kind: "delivery" as const, sequence: 0, cycleId: null, location }], returnPolicy: "delivery_only" as const, base: null, plannedWindow: null };

describe("Fleet dispatch planning contract", () => {
  it("keeps an authorized ticket attached while Yard and driver selection are pending", () => {
    const input = FleetDispatchPlanInputSchema.parse({ operationId: id(1), fleetId: id(2), title: "Haul", billingSiteId: 7, routePlan: route, ticket: { kind: "authorized", ticketId: 88 }, detailId: null, driverUserId: null });
    const plan = FleetDispatchPlanSchema.parse({ ...input, id: id(3), companyId: 11, version: 1, state: "waiting_on_yard", runId: null, createdByUserId: 9, createdAt: "2026-10-20T12:00:00Z" });
    expect(plan.ticket).toEqual({ kind: "authorized", ticketId: 88 });
    expect(plan.driverUserId).toBeNull();
    expect(plan.runId).toBeNull();
  });

  it("rejects a billable draft without an authorized ticket", () => {
    expect(FleetDispatchPlanInputSchema.safeParse({ operationId: id(1), fleetId: id(2), title: "Haul", billingSiteId: 7, routePlan: route, ticket: { kind: "office_review_draft", billable: true }, detailId: null, driverUserId: null }).success).toBe(false);
  });
});
