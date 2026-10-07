import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { emptyFleetState, type FleetState } from "./fleet-repository";
import { createFleetCargoOperations } from "./fleet-cargo";
import { summarizeFleetRecords } from "./fleet-reporting";
function fixture() {
  const fleetId = randomUUID(),
    siteId = 9,
    sourceStop = randomUUID(),
    targetStop = randomUUID(),
    delivery = randomUUID();
  const make = (driverUserId: number, stopId: string) =>
    FleetRunSchema.parse({
      id: randomUUID(),
      fleetId,
      companyId: 7,
      title: "Synthetic",
      driverUserId,
      vehicleAssetId: randomUUID(),
      trailerAssetId: null,
      siteIds: [siteId],
      status: "in_progress",
      phase: "paused",
      version: 4,
      stops: [
        { id: stopId, siteId, kind: "pickup", sequence: 0 },
        { id: delivery, siteId, kind: "delivery", sequence: 1 },
      ],
      loads: [],
      inspections: [],
      currentStopId: stopId,
      visitedStopIds: [],
      events: [],
      linkedTicketId: null,
      allowedActions: [],
    });
  const source = make(2, sourceStop),
    target = make(3, targetStop),
    loadId = randomUUID();
  source.loads.push({
    id: loadId,
    pickupStopId: sourceStop,
    deliveryStopId: null,
    commodity: "Bulk",
    quantity: 20,
    unit: "tons",
    manifestReference: "Original fictional manifest",
    deliveryReference: null,
    recordedByUserId: 2,
    recordedAt: "2026-10-08T12:00:00Z",
    deliveredAt: null,
    source: "user_report",
  });
  let state = {
      ...emptyFleetState(),
      enabled: true,
      runs: [source, target],
      grants: [
        {
          userId: 2,
          fleetIds: [fleetId],
          siteIds: [9],
          roles: ["driver" as const],
          safetyRelease: false,
          financeRead: false,
        },
        {
          userId: 3,
          fleetIds: [fleetId],
          siteIds: [9],
          roles: ["driver" as const],
          safetyRelease: false,
          financeRead: false,
        },
      ],
    },
    held = false,
    authority = true;
  let audit: { type: string; id: string; value: any }[] = [];
  const client = {
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes("FROM vendor_people")) return { rows: [{ id: 2 }] };
      if (sql.startsWith("INSERT")) {
        const type = sql.includes("cargo-transfer-operation")
          ? "operation"
          : "transfer";
        audit.push({
          type,
          id: String(args[2]),
          value: JSON.parse(String(args[3])),
        });
        return { rows: [] };
      }
      if (sql.includes("DISTINCT ON")) return { rows: [] };
      const type = sql.includes("fleet-cargo-operation")
          ? "operation"
          : "transfer",
        items = audit.filter(
          (row) => row.type === type && row.id === String(args[1]),
        );
      return {
        rows: items.length ? [{ tool_output: items.at(-1)!.value }] : [],
      };
    },
  } as unknown as PoolClient;
  const tx = async <T>(
    bound: FleetActor,
    op: (s: FleetState, c: PoolClient) => Promise<T>,
  ) => {
    bound.currentSiteIds = bound.activeSiteIds = authority ? [9] : [];
    const next = structuredClone(state),
      before = audit.slice();
    try {
      const result = await op(next, client);
      state = next;
      return result;
    } catch (error) {
      audit = before;
      throw error;
    }
  };
  const permitted = (
    _s: FleetState,
    actor: FleetActor,
    run: typeof source,
    action: string,
  ) =>
    authority &&
    actor.companyId === run.companyId &&
    (action === "dispatch"
      ? actor.userId === 1
      : action === "perform_run"
        ? actor.userId === run.driverUserId
        : actor.userId === 1 || actor.userId === run.driverUserId);
  const service = createFleetCargoOperations(tx, permitted, async () => {
    if (held) throw Error("Held recipient");
  });
  const input = {
    operationId: randomUUID(),
    sourceRunId: source.id,
    targetRunId: target.id,
    sourceExpectedVersion: 4,
    targetExpectedVersion: 4,
    sourceLoadId: loadId,
    targetLoadId: randomUUID(),
    siteId: 9,
    targetDeliveryStopId: delivery,
    quantity: 20,
    reason: "User-reported replacement plan",
  };
  const actor = (userId: number): FleetActor => ({ userId, companyId: 7 });
  const command = (version: number, action: string) => ({
    operationId: randomUUID(),
    expectedVersion: version,
    sourceExpectedVersion: 4,
    targetExpectedVersion: 4,
    action,
    notes: "Actual user acknowledgement",
  });
  return {
    service,
    input,
    actor,
    command,
    state: () => state,
    hold: () => {
      held = true;
    },
    revoke: () => {
      authority = false;
    },
  };
}
describe("Fleet cargo handoff record authority", () => {
  it("requires separate exact drivers and manager completion while preserving original provenance", async () => {
    const f = fixture();
    let record = await f.service.prepareCargoTransfer(f.actor(1), f.input);
    expect(record.status).toBe("proposed");
    await expect(
      f.service.cargoAction(
        f.actor(1),
        record.id,
        f.command(record.version, "acknowledge_source"),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service.cargoAction(
        f.actor(2),
        record.id,
        f.command(record.version, "acknowledge_target"),
      ),
    ).rejects.toMatchObject({ status: 403 });
    record = await f.service.cargoAction(
      f.actor(2),
      record.id,
      f.command(record.version, "acknowledge_source"),
    );
    await expect(
      f.service.cargoAction(
        f.actor(1),
        record.id,
        f.command(record.version, "complete"),
      ),
    ).rejects.toMatchObject({ status: 403 });
    record = await f.service.cargoAction(
      f.actor(3),
      record.id,
      f.command(record.version, "acknowledge_target"),
    );
    const complete = f.command(record.version, "complete");
    record = await f.service.cargoAction(f.actor(1), record.id, complete);
    expect(record).toMatchObject({
      status: "completed",
      sourceAcknowledgedBy: 2,
      targetAcknowledgedBy: 3,
      physicalHandoffVerified: false,
      inventoryCustodyChanged: false,
    });
    expect(f.state().runs[0].loads[0].transferOut?.transferId).toBe(record.id);
    expect(f.state().runs[1].loads[0]).toMatchObject({
      id: f.input.targetLoadId,
      manifestReference: "Original fictional manifest",
      recordedByUserId: 2,
      recordedAt: "2026-10-08T12:00:00Z",
      source: "user_report",
      plannedDeliveryStopId: f.input.targetDeliveryStopId,
    });
    expect(
      await f.service.cargoAction(f.actor(1), record.id, complete),
    ).toMatchObject({ status: "completed" });
    expect(f.state().runs[1].loads).toHaveLength(1);
    expect(summarizeFleetRecords(f.state().runs, {}, false).loadTotals).toEqual(
      [{ commodity: "Bulk", unit: "tons", quantity: 20, deliveredQuantity: 0 }],
    );
  });
  it("rejects foreign actor, partial quantity, nonpaused context and changed assignment versions", async () => {
    const f = fixture();
    await expect(
      f.service.prepareCargoTransfer({ ...f.actor(1), companyId: 8 }, f.input),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.prepareCargoTransfer(f.actor(1), { ...f.input, quantity: 10 }),
    ).rejects.toMatchObject({ status: 400 });
    f.state().runs[1].phase = "at_pickup";
    await expect(
      f.service.prepareCargoTransfer(f.actor(1), f.input),
    ).rejects.toMatchObject({ status: 403 });
    f.state().runs[1].phase = "paused";
    const record = await f.service.prepareCargoTransfer(f.actor(1), f.input);
    f.state().runs[0].version++;
    await expect(
      f.service.cargoAction(
        f.actor(2),
        record.id,
        f.command(record.version, "acknowledge_source"),
      ),
    ).rejects.toMatchObject({ code: "fleet.version_conflict" });
  });
  it("rechecks recipient hold and revoked grants before recording completion", async () => {
    const f = fixture();
    let record = await f.service.prepareCargoTransfer(f.actor(1), f.input);
    record = await f.service.cargoAction(
      f.actor(2),
      record.id,
      f.command(record.version, "acknowledge_source"),
    );
    record = await f.service.cargoAction(
      f.actor(3),
      record.id,
      f.command(record.version, "acknowledge_target"),
    );
    f.hold();
    await expect(
      f.service.cargoAction(
        f.actor(1),
        record.id,
        f.command(record.version, "complete"),
      ),
    ).rejects.toThrow("Held recipient");
    expect(f.state().runs[1].loads).toEqual([]);
    f.revoke();
    await expect(
      f.service.cargoTransfer(f.actor(2), record.id),
    ).rejects.toMatchObject({ status: 404 });
  });
});
