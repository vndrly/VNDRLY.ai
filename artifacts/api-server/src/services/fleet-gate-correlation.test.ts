import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import { createFleetGateOperations } from "./fleet-gate-correlation";
import { emptyFleetState } from "./fleet-repository";
function fixture() {
  const vehicle = randomUUID(),
    stopId = randomUUID(),
    run = FleetRunSchema.parse({
      id: randomUUID(),
      companyId: 7,
      fleetId: randomUUID(),
      title: "Synthetic",
      driverUserId: 2,
      vehicleAssetId: vehicle,
      trailerAssetId: null,
      siteIds: [9],
      status: "in_progress",
      phase: "traveling_to_pickup",
      version: 4,
      stops: [{ id: stopId, siteId: 9, kind: "pickup", sequence: 0 }],
      loads: [],
      inspections: [],
      currentStopId: null,
      visitedStopIds: [],
      events: [
        {
          id: randomUUID(),
          operationId: randomUUID(),
          type: "created",
          actorUserId: 1,
          recordedAt: new Date().toISOString(),
        },
      ],
      linkedTicketId: null,
      allowedActions: [],
    });
  let state = { ...emptyFleetState(), runs: [run] },
    authorized = true;
  const writes: string[] = [],
    audit: { type: string; id: string; value: any }[] = [];
  const rows = [1, 2].map((id) => ({
    id,
    site_location_id: 9,
    provisional_vehicle_asset_id: vehicle,
    check_in_time: new Date(),
    check_out_time: null,
    observed_arrival_at: null,
    observed_departure_at: null,
    observation_source: null,
    reconciliation_state: "not_required",
    first_name: "Must never return",
    email: "private@example.test",
  }));
  const client = {
    query: async (sql: string, args: any[]) => {
      if (sql.startsWith("SELECT v.id")) return { rows };
      if (sql.startsWith("SELECT tool_output")) {
        const type = sql.includes("'fleet-gate-operation'")
          ? "fleet-gate-operation"
          : "fleet-gate-link";
        return {
          rows: audit
            .filter((a) => a.type === type && a.id === args[1])
            .slice(-1)
            .map((a) => ({ tool_output: a.value })),
        };
      }
      if (sql.startsWith("INSERT")) {
        writes.push(sql);
        audit.push({ type: args[2], id: args[3], value: JSON.parse(args[4]) });
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const service = createFleetGateOperations(
    async (_, operation) => {
      const copy = structuredClone(state),
        result = await operation(copy, client);
      state = copy;
      return result;
    },
    () => authorized,
  );
  return {
    service,
    run,
    stopId,
    state: () => state,
    writes,
    revoke: () => {
      authorized = false;
    },
    actor: { userId: 2, companyId: 7 },
  };
}
describe("Fleet existing Gate correlation", () => {
  it("preserves ambiguous candidates and excludes all visitor identity fields", async () => {
    const f = fixture(),
      result = await f.service.gateObservations(f.actor, f.run.id);
    expect(result.ambiguous).toBe(true);
    expect(result.automaticAdmissionCreated).toBe(false);
    expect(JSON.stringify(result)).not.toContain("Must never return");
    expect(JSON.stringify(result)).not.toContain("private@example");
    expect(f.writes).toEqual([]);
    f.revoke();
    await expect(
      f.service.gateObservations(f.actor, f.run.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("links selected candidate once with CAS and exact replay without changing Gate or arrival", async () => {
    const f = fixture(),
      input = {
        operationId: randomUUID(),
        expectedVersion: 4,
        stopId: f.stopId,
        visitId: 1,
        reason: "Operator selected existing observation",
      };
    const result = await f.service.linkGateVisit(f.actor, f.run.id, input);
    expect(await f.service.linkGateVisit(f.actor, f.run.id, input)).toEqual(
      result,
    );
    expect(f.state().runs[0].version).toBe(5);
    expect(f.state().runs[0].phase).toBe("traveling_to_pickup");
    expect(
      f.writes.every((sql) => sql.includes("assistant_action_audit")),
    ).toBe(true);
    expect(f.writes).toHaveLength(2);
    await expect(
      f.service.linkGateVisit(f.actor, f.run.id, {
        ...input,
        operationId: randomUUID(),
        expectedVersion: 5,
      }),
    ).rejects.toMatchObject({ code: "fleet.gate_visit_already_linked" });
  });
  it("refuses wrong stop/site candidate and stale revision before saved correlation", async () => {
    const f = fixture(),
      input = {
        operationId: randomUUID(),
        expectedVersion: 4,
        stopId: randomUUID(),
        visitId: 1,
        reason: "Wrong stop",
      };
    await expect(
      f.service.linkGateVisit(f.actor, f.run.id, input),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.linkGateVisit(f.actor, f.run.id, {
        ...input,
        stopId: f.stopId,
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ code: "fleet.version_conflict" });
    expect(f.writes).toEqual([]);
  });
});
