import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { FleetReportSchema, FleetRunSchema } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import {
  summarizeFleetRecords,
  createFleetReportingOperations,
} from "./fleet-reporting";
import { emptyFleetState } from "./fleet-repository";
const fleetId = randomUUID(),
  assetId = randomUUID();
function run(driverUserId = 2) {
  return FleetRunSchema.parse({
    id: randomUUID(),
    companyId: 7,
    fleetId,
    title: "Synthetic",
    driverUserId,
    vehicleAssetId: assetId,
    trailerAssetId: null,
    siteIds: [9],
    status: "completed",
    phase: null,
    version: 10,
    stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }],
    loads: [],
    inspections: [],
    currentStopId: null,
    visitedStopIds: [],
    events: [],
    linkedTicketId: null,
    allowedActions: [],
  });
}
describe("source-bound Fleet reports", () => {
  it("keeps commodities and units separate, meters assignment-bound, and finance data gated", () => {
    const record = run();
    const stamp = new Date().toISOString();
    record.loads = [
      {
        id: randomUUID(),
        pickupStopId: randomUUID(),
        deliveryStopId: null,
        commodity: "gravel",
        quantity: 10,
        unit: "tons",
        manifestReference: "fictional",
        deliveryReference: null,
        recordedByUserId: 2,
        recordedAt: stamp,
        deliveredAt: stamp,
        source: "user_report",
      },
      {
        id: randomUUID(),
        pickupStopId: randomUUID(),
        deliveryStopId: null,
        commodity: "water",
        quantity: 20,
        unit: "barrels",
        manifestReference: "fictional",
        deliveryReference: null,
        recordedByUserId: 2,
        recordedAt: stamp,
        deliveredAt: null,
        source: "user_report",
      },
    ];
    record.records = [
      {
        id: randomUUID(),
        vehicleAssetId: assetId,
        capturedAt: null,
        kind: "meter",
        reading: 100,
        quantity: null,
        unit: "miles",
        notes: "User report",
        recordedByUserId: 2,
        recordedAt: stamp,
        source: "user_report",
      },
      {
        id: randomUUID(),
        vehicleAssetId: assetId,
        capturedAt: null,
        kind: "meter",
        reading: 110,
        quantity: null,
        unit: "miles",
        notes: "User report",
        recordedByUserId: 2,
        recordedAt: stamp,
        source: "user_report",
      },
      {
        id: randomUUID(),
        vehicleAssetId: assetId,
        capturedAt: null,
        kind: "fuel",
        reading: null,
        quantity: 5,
        unit: "gallons",
        notes: "User report",
        recordedByUserId: 2,
        recordedAt: stamp,
        source: "user_report",
      },
    ];
    const report = summarizeFleetRecords([record], {}, false);
    expect(FleetReportSchema.safeParse(report).success).toBe(true);
    expect(report.loadTotals).toEqual([
      {
        commodity: "gravel",
        unit: "tons",
        quantity: 10,
        deliveredQuantity: 10,
      },
      {
        commodity: "water",
        unit: "barrels",
        quantity: 20,
        deliveredQuantity: 0,
      },
    ]);
    expect(report.distanceTotals).toEqual([{ unit: "miles", distance: 10 }]);
    expect(report.fuelTotals).toBeNull();
    expect(summarizeFleetRecords([record], {}, true).fuelTotals).toEqual([
      { unit: "gallons", quantity: 5 },
    ]);
    expect(report.unavailableMetrics.map((m) => m.metric)).toContain(
      "cost_per_run",
    );
  });
  it("rechecks current own-driver/company/site scope on records and refuses foreign requested filters", async () => {
    const own = run(),
      other = run(3),
      foreign = { ...run(), companyId: 8 },
      revoked = { ...run(), siteIds: [10] };
    const query = vi.fn(async () => ({
      rows: [own, other, foreign, revoked].map((tool_output) => ({
        tool_output,
      })),
    }));
    const client = { query } as unknown as PoolClient;
    const grant = {
      fleetIds: [fleetId],
      siteIds: [9],
      roles: ["driver"],
      financeRead: false,
    };
    const service = createFleetReportingOperations(
      async (_, operation) => operation(emptyFleetState(), client),
      () => grant,
    );
    expect(
      (await service.report({ userId: 2, companyId: 7 }, {})).runCount,
    ).toBe(1);
    query.mockClear();
    await expect(
      service.report({ userId: 2, companyId: 7 }, { siteId: 10 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects invalid date intervals before a database operation", async () => {
    const operation = vi.fn();
    const service = createFleetReportingOperations(operation, () => null);
    expect(() =>
      service.report(
        { userId: 2, companyId: 7 },
        { startsAt: "2026-10-07T12:00:00Z", endsAt: "2026-10-06T12:00:00Z" },
      ),
    ).toThrow();
    expect(operation).not.toHaveBeenCalled();
  });
});
