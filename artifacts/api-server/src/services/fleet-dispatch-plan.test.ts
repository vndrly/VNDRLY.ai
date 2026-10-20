import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { FleetDispatchPlanInputSchema } from "@workspace/api-zod";
import { createFleetService } from "./fleet-ops";
import { emptyFleetState, type FleetRepository } from "./fleet-repository";

vi.mock("./fleet-commercial-authority", async original => ({ ...(await original<typeof import("./fleet-commercial-authority")>()), readFleetAuthoritySites: async () => [{ id: 7, is_active: true }] }));
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const location = { type: "provisional" as const, localId: id(4), name: "Job", address: "Job", latitude: null, longitude: null, capturedAt: "2026-10-20T12:00:00Z" };
const input = () => FleetDispatchPlanInputSchema.parse({ operationId: id(1), fleetId: id(2), title: "Haul", billingSiteId: 7, routePlan: { origin: location, stops: [{ id: id(5), kind: "delivery", sequence: 0, cycleId: null, location }], returnPolicy: "delivery_only", base: null, plannedWindow: null }, ticket: { kind: "office_review_draft", billable: false }, detailId: null, driverUserId: null });

function fixture() {
  const state = emptyFleetState(); state.enabled = true;
  state.fleets.push({ id: id(2), name: "Main", siteIds: [7], equipmentAssetIds: [], requiredCertifications: [] });
  state.grants.push({ userId: 9, fleetIds: [id(2)], siteIds: [7], roles: ["dispatcher"], safetyRelease: false, financeRead: false });
  const query = vi.fn(async (_sql: string): Promise<{ rows: { id: number }[] }> => ({ rows: [] }));
  const repository: FleetRepository = { transaction: async (_company, _user, operation) => operation(state, { query } as unknown as PoolClient) };
  return { service: createFleetService(repository), state, query, actor: { userId: 9, companyId: 11, role: "vendor", membershipRole: "member", activeMembershipId: 2, sv: 1 } };
}

describe("dispatch plans", () => {
  it("retains the same driver-free waiting plan for an exact retry", async () => {
    const f = fixture(), request = input();
    const first = await f.service.saveDispatchPlan(f.actor, request);
    expect(await f.service.saveDispatchPlan(f.actor, request)).toEqual(first);
    expect((await f.service.dispatchPlans(f.actor)).plans).toEqual([first]);
    expect(first).toMatchObject({ driverUserId: null, detailId: null, state: "waiting_on_yard", ticket: { kind: "office_review_draft", billable: false } });
    expect(f.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO tickets"))).toBe(false);
    expect(f.query.mock.calls.filter(([sql]) => String(sql).includes("'fleet-dispatch-plan'")).length).toBe(1);
  });

  it("requires the selected driver and Detail before marking a plan ready", async () => {
    const f = fixture(), plan = await f.service.saveDispatchPlan(f.actor, input());
    await expect(f.service.updateDispatchPlan(f.actor, plan.id, { operationId: id(8), expectedVersion: plan.version, state: "ready_to_dispatch" })).rejects.toMatchObject({ code: "fleet.dispatch_assignment_required" });
    expect((await f.service.dispatchPlans(f.actor)).plans[0].state).toBe("waiting_on_yard");
  });

  it("does not let a ready plan lose its dispatch assignment on a partial update", async () => {
    const f = fixture(), plan = await f.service.saveDispatchPlan(f.actor, input());
    const ready = await f.service.updateDispatchPlan(f.actor, plan.id, {
      operationId: id(20), expectedVersion: plan.version, state: "ready_to_dispatch",
      detailId: id(21), driverUserId: 22,
    });
    await expect(f.service.updateDispatchPlan(f.actor, plan.id, {
      operationId: id(23), expectedVersion: ready.version, detailId: null,
    })).rejects.toMatchObject({ code: "fleet.dispatch_assignment_required" });
    expect((await f.service.dispatchPlans(f.actor)).plans[0]).toMatchObject({
      state: "ready_to_dispatch", detailId: id(21), driverUserId: 22, version: ready.version,
    });
  });

  it("refuses to link another company's Yard Order while preserving the waiting plan", async () => {
    const f = fixture(), plan = await f.service.saveDispatchPlan(f.actor, input());
    f.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("SELECT status,outcome,detail_id FROM fleet_yard_orders") ? [] : [] }));
    await expect(f.service.updateDispatchPlan(f.actor, plan.id, { operationId: id(16), expectedVersion: 1,
      detailId: id(17), yardOrderId: id(18), state: "waiting_on_yard" })).rejects.toMatchObject({ code: "fleet.yard_not_found" });
    const unchanged = (await f.service.dispatchPlans(f.actor)).plans[0];
    expect(unchanged.version).toBe(1);
    expect(unchanged).not.toHaveProperty("yardOrderId");
  });

  it("rejects another actor's retry and unauthorized ticket substitution", async () => {
    const f = fixture(), request = input();
    await f.service.saveDispatchPlan(f.actor, request);
    f.state.grants.push({ userId: 10, fleetIds: [id(2)], siteIds: [7], roles: ["dispatcher"], safetyRelease: false, financeRead: false });
    await expect(f.service.saveDispatchPlan({ ...f.actor, userId: 10 }, request)).rejects.toMatchObject({ code: "fleet.operation_conflict" });
    const plan = (await f.service.dispatchPlans(f.actor)).plans[0];
    await expect(f.service.updateDispatchPlan(f.actor, plan.id, { operationId: id(9), expectedVersion: plan.version, ticket: { kind: "authorized", ticketId: 88 } })).rejects.toMatchObject({ code: "fleet.ticket_not_authorized" });
  });

  it("lets Office attach a currently authorized ticket without changing Yard or driver plans", async () => {
    const f = fixture(), plan = await f.service.saveDispatchPlan(f.actor, input());
    f.state.grants.push({ userId: 12, fleetIds: [id(2)], siteIds: [7], roles: [], safetyRelease: false, financeRead: true });
    f.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("SELECT id FROM tickets") ? [{ id: 88 }] : [] }));
    const office = { ...f.actor, userId: 12, fleetCapabilities: new Set(["office" as const]) };
    const saved = await f.service.updateDispatchPlan(office, plan.id, { operationId: id(12), expectedVersion: 1, ticket: { kind: "authorized", ticketId: 88 } });
    expect(saved).toMatchObject({ version: 2, state: "waiting_on_yard", detailId: null, driverUserId: null, ticket: { kind: "authorized", ticketId: 88 } });
    expect(await f.service.updateDispatchPlan(office, plan.id, { operationId: id(12), expectedVersion: 1, ticket: { kind: "authorized", ticketId: 88 } })).toEqual(saved);
    expect(await f.service.dispatchPlanTickets(office, 7)).toEqual({ tickets: [{ id: 88 }] });
    await expect(f.service.updateDispatchPlan(office, plan.id, { operationId: id(14), expectedVersion: 2, ticket: { kind: "authorized", ticketId: 99 } })).rejects.toMatchObject({ code: "fleet.ticket_link_locked" });
    await expect(f.service.updateDispatchPlan(office, plan.id, { operationId: id(13), expectedVersion: 2, state: "ready_to_dispatch" })).rejects.toMatchObject({ code: "fleet.dispatch_required" });
  });
});
