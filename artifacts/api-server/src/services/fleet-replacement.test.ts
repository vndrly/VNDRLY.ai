import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FleetRunSchema,
  fleetReplacementReady,
  previewFleetRunActions,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { createFleetService } from "./fleet-ops";
import { createFleetReplacementOperations } from "./fleet-replacement";
import {
  emptyFleetState,
  type FleetState,
  type FleetRepository,
} from "./fleet-repository";
import { summarizeFleetRecords } from "./fleet-reporting";

function fixture() {
  const old = randomUUID(),
    replacement = randomUUID();
  const run = FleetRunSchema.parse({
    id: randomUUID(),
    fleetId: randomUUID(),
    companyId: 7,
    title: "Fictional paused run",
    driverUserId: 2,
    vehicleAssetId: old,
    trailerAssetId: null,
    siteIds: [9],
    status: "in_progress",
    phase: "paused",
    pausedFromPhase: "driving",
    version: 4,
    stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }],
    loads: [],
    records: [],
    inspections: [],
    currentStopId: null,
    visitedStopIds: [],
    events: [],
    linkedTicketId: null,
    allowedActions: [],
  });
  let state: FleetState = { ...emptyFleetState(), enabled: true, runs: [run] };
  let held = false,
    custody = true,
    revoked = false;
  const audit: { type: string; id: string; value: any }[] = [];
  const client = {
    query: async (sql: string, values: any[]) => {
      if (sql.startsWith("INSERT")) {
        audit.push({
          type: sql.includes("'fleet-replacement-operation'")
            ? "operation"
            : "record",
          id: values[2],
          value: JSON.parse(values[3]),
        });
        return { rows: [] };
      }
      if (sql.includes("FROM assets"))
        return { rows: custody ? [{ id: values[0] }] : [] };
      const type = sql.includes("'fleet-replacement-operation'")
        ? "operation"
        : "record";
      if (sql.includes("status'='proposed'")) {
        const latest = new Map<string, any>();
        for (const row of audit.filter((row) => row.type === "record"))
          latest.set(row.id, row.value);
        return {
          rows: [...latest.values()]
            .filter(
              (row) => row.runId === values[1] && row.status === "proposed",
            )
            .map((tool_output) => ({ tool_output })),
        };
      }
      if (sql.includes("runId'=$2")) {
        const latest = new Map<string, any>();
        for (const row of audit.filter((row) => row.type === "record"))
          latest.set(row.id, row.value);
        return {
          rows: [...latest.values()]
            .filter((row) => row.runId === values[1])
            .map((tool_output) => ({ tool_output })),
        };
      }
      const row = audit
        .filter((row) => row.type === type && row.id === values[1])
        .at(sql.includes("DESC") ? -1 : 0);
      return { rows: row ? [{ tool_output: row.value }] : [] };
    },
  } as unknown as PoolClient;
  const permitted = (
    _state: FleetState,
    actor: FleetActor,
    _run: unknown,
    action: string,
  ) =>
    !revoked &&
    actor.companyId === 7 &&
    (action === "dispatch"
      ? actor.userId === 1
      : action === "perform_run"
        ? actor.userId === 2
        : [1, 2].includes(actor.userId));
  const service = createFleetReplacementOperations(
    async (actor, fn) => {
      const next = structuredClone(state),
        before = audit.length;
      try {
        const result = await fn(next, client);
        state = next;
        return result;
      } catch (error) {
        audit.splice(before);
        throw error;
      }
    },
    permitted,
    async () => {
      if (held) throw new Error("equipment_on_hold");
    },
  );
  const manager = { userId: 1, companyId: 7 },
    driver = { userId: 2, companyId: 7 };
  return {
    service,
    manager,
    driver,
    runId: run.id,
    replacement,
    old,
    state: () => state,
    hold: () => {
      held = true;
    },
    revoke: () => {
      revoked = true;
    },
    loseCustody: () => {
      custody = false;
    },
  };
}
describe("Fleet paused equipment replacement", () => {
  it("actual run actions require fresh inspection/meter and current custody before resume", async () => {
    const f = fixture();
    const prior = f.state().runs[0];
    prior.records.push({
      id: randomUUID(),
      vehicleAssetId: f.old,
      kind: "meter",
      quantity: null,
      reading: 100000,
      unit: "miles",
      notes: "Prior actual equipment meter",
      recordedByUserId: 2,
      recordedAt: new Date().toISOString(),
      capturedAt: null,
      source: "user_report",
    });
    const proposal = await f.service.proposeReplacement(f.manager, f.runId, {
      operationId: randomUUID(),
      expectedVersion: 4,
      vehicleAssetId: f.replacement,
      trailerAssetId: null,
      reason: "Fictional new truck",
    });
    await f.service.replacementAction(f.driver, f.runId, proposal.id, {
      operationId: randomUUID(),
      expectedVersion: 1,
      runExpectedVersion: 4,
      action: "accept",
      notes: "Actual assigned driver's acceptance",
    });
    let state = f.state(),
      owned = false;
    state.fleets = [
      {
        id: prior.fleetId,
        name: "Fictional",
        siteIds: [9],
        equipmentAssetIds: [f.old, f.replacement],
        requiredCertifications: [],
      },
    ];
    state.grants = [
      {
        userId: 2,
        fleetIds: [prior.fleetId],
        siteIds: [9],
        roles: ["driver"],
        safetyRelease: false,
        financeRead: false,
      },
    ];
    const client = {
      query: async (sql: string) => ({
        rows: sql.includes("FROM site_locations")
          ? [{ id: 9, is_active: true }]
          : sql.includes("vendor_people")
            ? [{ id: 2 }]
            : sql.includes("status='checked_out'")
              ? owned
                ? [{ id: f.replacement }]
                : []
              : sql.includes("FROM assets")
                ? [
                    {
                      id: f.replacement,
                      category: "truck",
                      status: owned ? "checked_out" : "available",
                      current_holder_user_id: owned ? 2 : null,
                    },
                  ]
                : [],
      }),
    } as unknown as PoolClient;
    const repo: FleetRepository = {
      async transaction(_company, _user, operation) {
        const next = structuredClone(state);
        const result = await operation(next, client);
        state = next;
        return result;
      },
    };
    const service = createFleetService(repo);
    const action = async (fields: Record<string, unknown>) =>
      service.action(f.driver, f.runId, {
        operationId: randomUUID(),
        expectedVersion: state.runs[0].version,
        ...fields,
      });
    await expect(action({ action: "resume" })).rejects.toMatchObject({
      code: "fleet.action_forbidden",
    });
    await action({
      action: "inspect",
      inspectionOutcome: "passed",
      notes: "I inspected the new truck",
    });
    await expect(action({ action: "resume" })).rejects.toMatchObject({
      code: "fleet.action_forbidden",
    });
    await action({
      action: "record_meter",
      reading: 500,
      unit: "miles",
      notes: "Actual new truck odometer",
    });
    await expect(action({ action: "resume" })).rejects.toMatchObject({
      code: "fleet.equipment_custody_conflict",
    });
    owned = true;
    const resumed = await action({ action: "resume" });
    expect(resumed).toMatchObject({
      phase: "driving",
      vehicleAssetId: f.replacement,
    });
    expect(
      resumed.records.map((row) => [row.vehicleAssetId, row.reading]),
    ).toEqual([
      [f.old, 100000],
      [f.replacement, 500],
    ]);
  });
  it("requires own driver acceptance and new equipment facts, retains old records and replays exactly", async () => {
    const f = fixture();
    const input = {
      operationId: randomUUID(),
      expectedVersion: 4,
      vehicleAssetId: f.replacement,
      trailerAssetId: null,
      reason: "Fictional replacement after canonical checkout",
    };
    const proposal = await f.service.proposeReplacement(
      f.manager,
      f.runId,
      input,
    );
    expect(proposal.events[0]).toMatchObject({
      operationId: input.operationId,
      action: "propose",
      actorUserId: 1,
    });
    expect(f.state().runs[0].vehicleAssetId).toBe(f.old);
    const action = {
      operationId: randomUUID(),
      expectedVersion: 1,
      runExpectedVersion: 4,
      action: "accept",
      notes: "I accepted my assigned equipment",
    };
    await expect(
      f.service.replacementAction(f.manager, f.runId, proposal.id, action),
    ).rejects.toMatchObject({ code: "fleet.action_forbidden" });
    const accepted = await f.service.replacementAction(
      f.driver,
      f.runId,
      proposal.id,
      action,
    );
    expect(accepted).toMatchObject({
      status: "accepted",
      acceptedByUserId: 2,
      inventoryCustodyChanged: false,
      physicalExchangeVerified: false,
    });
    expect(
      await f.service.replacementAction(f.driver, f.runId, proposal.id, action),
    ).toMatchObject({ version: accepted.version, allowedActions: [] });
    const run = f.state().runs[0];
    expect(run).toMatchObject({
      vehicleAssetId: f.replacement,
      version: 5,
      phase: "paused",
    });
    expect(fleetReplacementReady(run)).toBe(false);
    expect(previewFleetRunActions(run, []).allowedActions).not.toContain(
      "resume",
    );
    const now = new Date().toISOString();
    run.inspections.push({
      outcome: "passed",
      driverUserId: 2,
      vehicleAssetId: f.replacement,
      trailerAssetId: null,
      recordedByUserId: 2,
      recordedAt: now,
      notes: "Actually inspected",
      source: "user_report",
    });
    expect(fleetReplacementReady(run)).toBe(false);
    run.records.push({
      id: randomUUID(),
      vehicleAssetId: f.replacement,
      kind: "meter",
      quantity: null,
      reading: 500,
      unit: "miles",
      notes: "Actual replacement meter",
      recordedByUserId: 2,
      recordedAt: now,
      capturedAt: null,
      source: "user_report",
    });
    expect(fleetReplacementReady(run)).toBe(true);
    expect(previewFleetRunActions(run, []).allowedActions).toContain("resume");
    f.revoke();
    await expect(
      f.service.replacementAction(f.driver, f.runId, proposal.id, action),
    ).rejects.toMatchObject({ code: "fleet.not_found" });
  });
  it("refuses missing custody, duplicate pending proposals and holds added before acceptance", async () => {
    const f = fixture(),
      input = {
        operationId: randomUUID(),
        expectedVersion: 4,
        vehicleAssetId: f.replacement,
        trailerAssetId: null,
        reason: "Fictional equipment replacement",
      };
    const proposal = await f.service.proposeReplacement(
      f.manager,
      f.runId,
      input,
    );
    await expect(
      f.service.proposeReplacement(f.manager, f.runId, {
        ...input,
        operationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
    f.hold();
    await expect(
      f.service.replacementAction(f.driver, f.runId, proposal.id, {
        operationId: randomUUID(),
        expectedVersion: 1,
        runExpectedVersion: 4,
        action: "accept",
        notes: "Actual acknowledgement",
      }),
    ).rejects.toThrow("equipment_on_hold");
    expect(f.state().runs[0].vehicleAssetId).toBe(f.old);
    const other = fixture();
    other.loseCustody();
    await expect(
      other.service.proposeReplacement(other.manager, other.runId, {
        ...input,
        vehicleAssetId: other.replacement,
      }),
    ).rejects.toMatchObject({ code: "fleet.equipment_custody_conflict" });
  });
  it("does not subtract odometers across different replacement vehicles", () => {
    const f = fixture(),
      run = f.state().runs[0],
      now = new Date().toISOString();
    for (const [vehicleAssetId, reading] of [
      [f.old, 100],
      [f.old, 120],
      [f.replacement, 9000],
      [f.replacement, 9005],
    ] as const)
      run.records.push({
        id: randomUUID(),
        vehicleAssetId,
        kind: "meter",
        quantity: null,
        reading,
        unit: "miles",
        notes: "Actual meter report",
        recordedByUserId: 2,
        recordedAt: now,
        capturedAt: null,
        source: "user_report",
      });
    expect(summarizeFleetRecords([run], {}, false).distanceTotals).toEqual([
      { unit: "miles", distance: 25 },
    ]);
  });
  it("allows current dispatcher cancellation after a proposal's run revision became stale", async () => {
    const f = fixture(),
      proposal = await f.service.proposeReplacement(f.manager, f.runId, {
        operationId: randomUUID(),
        expectedVersion: 4,
        vehicleAssetId: f.replacement,
        trailerAssetId: null,
        reason: "Fictional proposal",
      });
    f.state().runs[0].version = 5;
    expect(
      (await f.service.replacements(f.manager, f.runId)).replacements[0]
        .allowedActions,
    ).toEqual(["cancel"]);
    expect(
      (await f.service.replacements(f.driver, f.runId)).replacements[0]
        .allowedActions,
    ).toEqual([]);
    const cancelled = await f.service.replacementAction(
      f.manager,
      f.runId,
      proposal.id,
      {
        operationId: randomUUID(),
        expectedVersion: 1,
        runExpectedVersion: 5,
        action: "cancel",
        notes: "Review changed; withdraw this proposal",
      },
    );
    expect(cancelled.status).toBe("cancelled");
    expect(f.state().runs[0]).toMatchObject({
      version: 5,
      vehicleAssetId: f.old,
    });
    await expect(
      f.service.proposeReplacement(f.manager, f.runId, {
        operationId: randomUUID(),
        expectedVersion: 5,
        vehicleAssetId: f.replacement,
        trailerAssetId: null,
        reason: "Fresh proposal",
      }),
    ).resolves.toMatchObject({ status: "proposed" });
  });
  it("retains prior meters but prevents old same-truck facts satisfying a trailer replacement", () => {
    const f = fixture(),
      run = f.state().runs[0],
      now = new Date().toISOString();
    run.inspections.push({
      outcome: "passed",
      driverUserId: 2,
      vehicleAssetId: f.old,
      trailerAssetId: null,
      recordedByUserId: 2,
      recordedAt: now,
      notes: "Earlier inspection",
      source: "user_report",
    });
    run.records.push({
      id: randomUUID(),
      vehicleAssetId: f.old,
      kind: "meter",
      quantity: null,
      reading: 100,
      unit: "miles",
      notes: "Earlier meter",
      recordedByUserId: 2,
      recordedAt: now,
      capturedAt: null,
      source: "user_report",
    });
    run.activeReplacement = {
      replacementId: randomUUID(),
      acceptedAt: now,
      priorVehicleAssetId: f.old,
      priorTrailerAssetId: null,
      inspectionCount: 1,
      recordCount: 1,
    };
    expect(fleetReplacementReady(run)).toBe(false);
    expect(previewFleetRunActions(run, []).allowedActions).not.toContain(
      "resume",
    );
    expect(run.records).toHaveLength(1);
  });
});
