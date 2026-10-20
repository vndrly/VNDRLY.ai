import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import type { FleetRun } from "@workspace/api-zod";
import { recordFleetReturn } from "./fleet-return";

const id = (n: number) => `88888888-8888-4888-8888-${String(n).padStart(12, "0")}`;
const run = {
  id: id(1), fleetId: id(2), companyId: 7, title: "Return equipment", driverUserId: 12,
  vehicleAssetId: id(3), trailerAssetId: id(4), siteIds: [9], status: "in_progress", phase: "returning", version: 8,
  stops: [{ id: id(5), siteId: 9, kind: "return", sequence: 0 }], loads: [], inspections: [], currentStopId: null,
  visitedStopIds: [id(5)], events: [], linkedTicketId: 44, allowedActions: ["submit_closeout"],
  resourceAssignment: {
    snapshot: { detail: { id: id(6), companyId: 7, version: 1, name: "Detail", vehicleAssetId: id(3), rigPackageId: id(7), rigPackageVersion: 1, driverUserId: null, accessGroupIds: [id(2)], effectiveFrom: "2026-10-20T12:00:00Z", effectiveUntil: null, archivedAt: null }, rigPackage: { id: id(7), companyId: 7, version: 1, name: "Rig", components: [{ assetId: id(4), role: "trailer", sequence: 0 }, { assetId: id(8), role: "accessory", sequence: 1 }], effectiveFrom: "2026-10-20T12:00:00Z", effectiveUntil: null, archivedAt: null }, labels: { truck: "Truck", driver: "Driver", rigPackage: "Rig", components: ["Trailer", "Pump"] }, carrierOfRecordId: 7, snapshottedAt: "2026-10-20T12:00:00Z" },
    reservation: { id: id(9), companyId: 7, runId: id(1), state: "active", assetIds: [id(3), id(4), id(8)], driverUserId: 12, startsAt: "2026-10-20T12:00:00Z", endsAt: "2026-10-20T18:00:00Z", version: 1 },
    returnPolicy: "return_required",
  },
} as unknown as FleetRun;

describe("Fleet return handoff", () => {
  it("records the truck and attached rigging returned and creates one Yard verification order", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = { query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM fleet_asset_custody")) return { rows: [id(3), id(4), id(8)].map(asset_id => ({ asset_id, state: "in_transit", run_id: run.id, detail_id: id(6), observed_at: "2026-10-20T15:00:00Z" })) };
      if (sql.includes("FROM fleet_yards")) return { rows: [{ id: id(10) }] };
      if (sql.includes("FROM fleet_yard_orders")) return { rows: [] };
      return { rows: [] };
    } } as unknown as PoolClient;
    const result = await recordFleetReturn(client, { companyId: 7, userId: 12 }, run, "Pump guard bent", "2026-10-20T18:00:00Z");
    expect(result.assetIds).toEqual([id(3), id(4), id(8)]);
    expect(result.yardOrderId).toMatch(/[0-9a-f-]{36}/);
    const custody = calls.filter(call => call.sql.includes("INSERT INTO fleet_asset_custody("));
    expect(custody).toHaveLength(3);
    expect(custody.every(call => call.params.includes("returned") && call.params.includes(id(10)))).toBe(true);
    expect(calls.some(call => call.sql.includes("INSERT INTO fleet_yard_orders") && call.params.includes(id(6)) && call.params.some(value => String(value).includes("Pump guard bent")))).toBe(true);
  });

  it("reuses the existing return verification order instead of duplicating it", async () => {
    const calls: string[] = [];
    const client = { query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FROM fleet_asset_custody")) return { rows: [id(3), id(4), id(8)].map(asset_id => ({ asset_id, state: "attached", run_id: run.id, detail_id: id(6), observed_at: "2026-10-20T15:00:00Z" })) };
      if (sql.includes("FROM fleet_yards")) return { rows: [] };
      if (sql.includes("FROM fleet_yard_orders")) return { rows: [{ id: id(11) }] };
      return { rows: [] };
    } } as unknown as PoolClient;
    const result = await recordFleetReturn(client, { companyId: 7, userId: 12 }, run, "", "2026-10-20T18:00:00Z");
    expect(result.yardOrderId).toBe(id(11));
    expect(calls.filter(sql => sql.includes("INSERT INTO fleet_yard_orders"))).toHaveLength(0);
  });

  it("preserves a component already transferred away and lists it for Yard discrepancy review", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = { query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM fleet_asset_custody")) return { rows: [
        { asset_id: id(3), state: "in_transit", run_id: run.id, detail_id: id(6), observed_at: "2026-10-20T15:00:00Z" },
        { asset_id: id(4), state: "attached", run_id: run.id, detail_id: id(6), observed_at: "2026-10-20T15:00:00Z" },
        { asset_id: id(8), state: "transferred", run_id: id(99), detail_id: id(98), observed_at: "2026-10-20T16:00:00Z" },
      ] };
      if (sql.includes("FROM fleet_yards")) return { rows: [{ id: id(10) }] };
      if (sql.includes("FROM fleet_yard_orders")) return { rows: [] };
      return { rows: [] };
    } } as unknown as PoolClient;

    const result = await recordFleetReturn(client, { companyId: 7, userId: 12 }, run, "Return review", "2026-10-20T18:00:00Z");

    expect(result.assetIds).toEqual([id(3), id(4)]);
    expect(result.discrepancyAssetIds).toEqual([id(8)]);
    expect(calls.filter(call => call.sql.includes("INSERT INTO fleet_asset_custody("))).toHaveLength(2);
    expect(calls.some(call => call.sql.includes("UPDATE assets") && (call.params[1] as string[]).includes(id(8)))).toBe(false);
    expect(calls.some(call => call.sql.includes("INSERT INTO fleet_yard_orders") && call.params.some(value => String(value).includes(id(8))))).toBe(true);
  });

  it("rejects delayed offline return when canonical custody is newer than its capture", async () => {
    const calls: string[] = [];
    const client = { query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FROM fleet_asset_custody")) return { rows: [{ asset_id: id(3), state: "transferred", run_id: id(99), detail_id: id(98), observed_at: "2026-10-20T19:00:00Z" }] };
      return { rows: [] };
    } } as unknown as PoolClient;

    await expect(recordFleetReturn(client, { companyId: 7, userId: 12 }, run, "Delayed sync", "2026-10-20T18:00:00Z")).rejects.toMatchObject({
      code: "fleet.custody_observation_conflict",
      status: 409,
    });
    expect(calls.some(sql => sql.includes("INSERT INTO fleet_asset_custody("))).toBe(false);
  });
});
