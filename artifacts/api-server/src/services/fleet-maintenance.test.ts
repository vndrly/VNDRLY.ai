import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { PoolClient } from "pg";
import { FleetRunSchema } from "@workspace/api-zod";
import { createFleetMaintenanceOperations } from "./fleet-maintenance";
import { emptyFleetState } from "./fleet-repository";
const fixture = () => {
  const fleetId = randomUUID(),
    assetId = randomUUID(),
    runId = randomUUID();
  const state = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: fleetId,
        name: "Synthetic",
        siteIds: [1],
        equipmentAssetIds: [assetId],
        requiredCertifications: [],
      },
    ],
    runs: [
      FleetRunSchema.parse({
        id: runId,
        companyId: 7,
        title: "Synthetic",
        status: "acknowledged",
        phase: null,
        version: 1,
        stops: [{ id: randomUUID(), siteId: 1, kind: "pickup", sequence: 0 }],
        loads: [],
        inspections: [],
        currentStopId: null,
        visitedStopIds: [],
        events: [],
        linkedTicketId: null,
        allowedActions: [],
        fleetId,
        driverUserId: 2,
        vehicleAssetId: assetId,
        trailerAssetId: null,
        siteIds: [1],
      }),
    ],
  };
  let rows: { type: string; id: string; value: any }[] = [],
    holds: string[] = [];
  const client = {
    query: async (sql: string, args: any[]) => {
      if (sql.startsWith("SELECT id FROM assets"))
        return { rows: args[0] === assetId ? [{ id: assetId }] : [] };
      if (sql.startsWith("INSERT INTO assistant_action_audit")) {
        rows.push({
          type: sql.includes("'fleet-maintenance-operation'")
            ? "operation"
            : "record",
          id: args[2],
          value: JSON.parse(args[3]),
        });
        return { rows: [] };
      }
      if (sql.startsWith("SELECT tool_output")) {
        const type = sql.includes("'fleet-maintenance-operation'")
          ? "operation"
          : "record";
        return {
          rows: rows
            .filter((r) => r.type === type && r.id === args[1])
            .slice(-1)
            .map((r) => ({ tool_output: r.value })),
        };
      }
      if (sql.startsWith("INSERT INTO asset_holds")) {
        holds.push(args[0]);
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE asset_holds")) {
        const exists = holds.includes(args[1]);
        holds = holds.filter((id) => id !== args[1]);
        return { rows: exists ? [{ id: args[1] }] : [] };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const grants = new Map([
    [
      1,
      {
        fleetIds: [fleetId],
        siteIds: [1],
        roles: ["fleet_manager"],
        safetyRelease: false,
      },
    ],
    [
      2,
      {
        fleetIds: [fleetId],
        siteIds: [1],
        roles: ["driver"],
        safetyRelease: false,
      },
    ],
  ]);
  const service = createFleetMaintenanceOperations(
    async (actor, operation) => {
      const before = structuredClone({ rows, holds });
      try {
        return await operation(state, client);
      } catch (error) {
        rows = before.rows;
        holds = before.holds;
        throw error;
      }
    },
    (_, actor) => grants.get(actor.userId) ?? null,
  );
  return {
    service,
    grants,
    fleetId,
    assetId,
    runId,
    holds: () => holds,
    addUnrelatedHold: () => {
      const id = randomUUID();
      holds.push(id);
      return id;
    },
    actor: (userId = 1) => ({ userId, companyId: 7 }),
    create: (userId = 1) =>
      service.maintenanceCreate(
        { userId, companyId: 7 },
        {
          operationId: randomUUID(),
          fleetId,
          assetId,
          runId,
          kind: "defect",
          title: "Reported tire defect",
          notes: "Driver reports damage; no physical verification.",
        },
      ),
  };
};
describe("Fleet maintenance authority and retained outcomes", () => {
  it("binds driver reports to actual own equipment/run, without manager impersonation", async () => {
    const f = fixture();
    const report = await f.create(2);
    expect(report.allowedActions).toEqual([]);
    expect(f.holds()).toHaveLength(1);
    await expect(
      f.service.maintenanceCreate(f.actor(2), {
        operationId: randomUUID(),
        fleetId: f.fleetId,
        assetId: f.assetId,
        runId: randomUUID(),
        kind: "defect",
        title: "Wrong run",
        notes: "Rejected",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.holds()).toHaveLength(1);
  });
  it("requires recorded repair and separate current safety-release grant; preserves unrelated holds", async () => {
    const f = fixture();
    const unrelated = f.addUnrelatedHold();
    const report = await f.create();
    await expect(
      f.service.maintenanceAction(f.actor(), report.id, {
        operationId: randomUUID(),
        expectedVersion: 1,
        action: "release",
        notes: "No repair",
      }),
    ).rejects.toMatchObject({ status: 403 });
    const repaired = await f.service.maintenanceAction(f.actor(), report.id, {
      operationId: randomUUID(),
      expectedVersion: 1,
      action: "record_repair",
      notes: "User reports repair completed",
    });
    expect(repaired.allowedActions).not.toContain("release");
    f.grants.get(1)!.safetyRelease = true;
    const released = await f.service.maintenanceAction(f.actor(), report.id, {
      operationId: randomUUID(),
      expectedVersion: 2,
      action: "release",
      notes: "Authorized release reviewed",
    });
    expect(released.status).toBe("released");
    expect(f.holds()).toEqual([unrelated]);
  });
  it("replays exact approved outcome once and refuses changed operation input", async () => {
    const f = fixture();
    const operationId = randomUUID(),
      input = {
        operationId,
        fleetId: f.fleetId,
        assetId: f.assetId,
        kind: "defect",
        title: "Synthetic",
        notes: "Reported damage",
      };
    const first = await f.service.maintenanceCreate(f.actor(), input);
    const replay = await f.service.maintenanceCreate(f.actor(), input);
    expect(replay.id).toBe(first.id);
    expect(f.holds()).toHaveLength(1);
    await expect(
      f.service.maintenanceCreate(f.actor(), { ...input, notes: "Different" }),
    ).rejects.toMatchObject({ code: "fleet.operation_reused" });
    expect(f.holds()).toHaveLength(1);
    f.grants.delete(1);
    await expect(
      f.service.maintenanceCreate(f.actor(), input),
    ).rejects.toMatchObject({ status: 404 });
  });
});
