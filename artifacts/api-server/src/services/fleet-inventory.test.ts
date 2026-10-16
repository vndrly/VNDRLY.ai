import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { emptyFleetState, FleetError, type FleetState } from "./fleet-repository";
import type { FleetActor } from "./fleet-ops";
import { createFleetInventoryOperations } from "./fleet-inventory";
const authority = vi.hoisted(() => vi.fn());
vi.mock("./asset-hold-release", () => ({ authorizeAssetHoldRelease: authority }));
const fleetId = randomUUID(), assetId = randomUUID();
const actor: FleetActor = { userId: 1, companyId: 7, role: "vendor", membershipRole: "admin" };
beforeEach(() => { authority.mockReset().mockResolvedValue(undefined); });
function fixture(roles = ["fleet_manager"]) {
  let state: FleetState = { ...emptyFleetState(), enabled: true, fleets: [{ id: fleetId, name: "Hauling", siteIds: [9], equipmentAssetIds: [], requiredCertifications: [] }], grants: [] };
  const assets = new Map<string, Record<string, unknown>>();
  const receipts = new Map<string, Record<string, unknown>>();
  const query = vi.fn(async (sql: string, p: unknown[] = []) => {
    if (sql.startsWith("SELECT user_id,tool_input")) return { rows: receipts.has(String(p[0])) ? [receipts.get(String(p[0]))] : [] };
    if (sql.startsWith("INSERT INTO assets")) {
      const id = String(p[0]); assets.set(id, { id, name: p[1], category: p[2], legal_owner_name: p[3], manufacturer: p[5], model: p[6], responsible_org_type: "vendor", responsible_org_id: 7, version: 1, status: "available", provisional: false });
      return { rows: [{ id, version: 1 }] };
    }
    if (sql.startsWith("INSERT INTO assistant_action_audit")) { receipts.set(String(p[2]), { user_id: p[0], vendor_id: p[1], tool_input: JSON.parse(String(p[3])), tool_output: JSON.parse(String(p[4])) }); return { rows: [] }; }
    if (sql.startsWith("SELECT a.*")) return { rows: assets.has(String(p[0])) ? [assets.get(String(p[0]))] : [] };
    if (sql.startsWith("UPDATE assets")) { const row = assets.get(String(p[0]))!; row.version = Number(row.version) + 1; return { rows: [{ version: row.version }] }; }
    return { rows: [] };
  });
  const service = createFleetInventoryOperations(async (_a, work) => {
    const next = structuredClone(state), savedAssets = structuredClone(assets), savedReceipts = structuredClone(receipts);
    try { const result = await work(next, { query } as unknown as PoolClient); state = next; return result; }
    catch (e) { assets.clear(); savedAssets.forEach((v, k) => assets.set(k, v)); receipts.clear(); savedReceipts.forEach((v, k) => receipts.set(k, v)); throw e; }
  }, (_s, a) => a.userId === 1 ? { fleetIds: [fleetId], roles } : null, () => true);
  return { service, query, state: () => state, assets };
}
const create = () => ({ operationId: randomUUID(), category: "truck", name: "Unit 12", legalOwner: "Synthetic Hauler", manufacturer: "", model: "", identifier: { kind: "asset_tag", value: "UNIT12" } });
describe("Fleet Inventory uses canonical assets", () => {
  it("creates one Inventory asset and automatically adds the same id to the fleet", async () => {
    const f = fixture(), body = create();
    const result = await f.service.createFleetAsset(actor, body);
    expect(f.assets.has(result.assetId)).toBe(true);
    expect(f.state().fleets[0].equipmentAssetIds).toEqual([]);
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO asset_attachment_links"))).toBe(true);
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO asset_aliases"))).toBe(true);
    expect(await f.service.createFleetAsset(actor, body)).toEqual(result);
    expect(f.assets.size).toBe(1);
  });
  it("rejects changed retries instead of registering another asset", async () => {
    const f = fixture(), body = create(); await f.service.createFleetAsset(actor, body);
    await expect(f.service.createFleetAsset(actor, { ...body, name: "Changed" })).rejects.toMatchObject({ code: "fleet.operation_conflict" });
    expect(f.assets.size).toBe(1);
  });
  it("keeps authorized pool and detail reads while hiding management for a read-only session", async () => {
    const f = fixture(), receipt = await f.service.createFleetAsset(actor, create());
    f.state().fleets[0].equipmentAssetIds = [receipt.assetId];
    const readOnlyActor = { ...actor, readOnly: true };
    expect((await f.service.fleetInventory(actor)).canManage).toBe(true);
    expect((await f.service.fleetInventory(readOnlyActor)).canManage).toBe(false);
    const listCalls = f.query.mock.calls.filter(([sql]) => sql.includes("ORDER BY a.id LIMIT 51"));
    expect(listCalls.at(-1)?.[1]?.[4]).toBe(true);
    const detail = await f.service.fleetInventoryDetail(readOnlyActor, receipt.assetId);
    expect(detail.asset.id).toBe(receipt.assetId);
    expect(detail.canManage).toBe(false);
    expect((await f.service.fleetInventoryDetail(actor, receipt.assetId)).canManage).toBe(true);
  });
  it("reads the exact saved receipt only for the original actor with current Inventory authority", async () => {
    const f = fixture(), body = create();
    const receipt = await f.service.createFleetAsset(actor, body);
    expect(await f.service.fleetInventoryReceipt(actor, body.operationId)).toEqual(receipt);
    await expect(f.service.fleetInventoryReceipt({ ...actor, userId: 2 }, body.operationId)).rejects.toMatchObject({ code: "fleet.operation_not_found", status: 404 });
    await expect(f.service.fleetInventoryReceipt(actor, randomUUID())).rejects.toMatchObject({ code: "fleet.operation_not_found", status: 404 });
    authority.mockRejectedValue(new FleetError("asset.asset_manager_required", 403));
    await expect(f.service.fleetInventoryReceipt(actor, body.operationId)).rejects.toMatchObject({ status: 403 });
  });
  it("limits scoped dispatchers to their Detail equipment", async () => {
    const f = fixture(["dispatcher"]);
    f.state().fleets[0].equipmentAssetIds = [assetId];
    const foreignAssetId = randomUUID();
    f.state().fleets.push({ id: randomUUID(), name: "Other Detail", siteIds: [], equipmentAssetIds: [foreignAssetId], requiredCertifications: [] });
    f.assets.set(foreignAssetId, { id: foreignAssetId, version: 1, category: "truck", responsible_org_type: "vendor", responsible_org_id: 7 });
    await f.service.fleetInventory(actor);
    const call = f.query.mock.calls.find(([sql]) => sql.includes("ORDER BY a.id LIMIT 51"));
    expect(call?.[1]?.[0]).toEqual([assetId]);
    expect(call?.[1]?.[4]).toBe(false);
    await expect(f.service.fleetInventoryDetail(actor, foreignAssetId)).rejects.toMatchObject({ status: 404 });
  });
  it("limits driver reads to current own assigned equipment", async () => {
    const f = fixture(["driver"]), another = randomUUID();
    f.state().fleets[0].equipmentAssetIds = [assetId, another];
    f.state().runs = [{ id: randomUUID(), driverUserId: 1, vehicleAssetId: assetId, trailerAssetId: null, status: "dispatched" }] as FleetState["runs"];
    f.assets.set(another, { id: another, version: 1, category: "truck", responsible_org_type: "vendor", responsible_org_id: 7 });
    await f.service.fleetInventory(actor);
    const call = f.query.mock.calls.find(([sql]) => sql.includes("ORDER BY a.id LIMIT 51"));
    expect(call?.[1]?.[0]).toEqual([assetId]);
    expect(call?.[1]?.[4]).toBe(false);
    await expect(f.service.fleetInventoryDetail(actor, another)).rejects.toMatchObject({ status: 404 });
  });
  it("does not accept a Detail assignment as part of asset registration", async () => {
    const f = fixture();
    await expect(async () => f.service.createFleetAsset(actor, { ...create(), fleetId })).rejects.toBeTruthy();
    expect(f.assets.size).toBe(0);
  });
  it("requires current Inventory management authority as well as fleet access", async () => {
    const f = fixture(); authority.mockRejectedValue(new FleetError("asset.asset_manager_required", 403));
    await expect(f.service.createFleetAsset(actor, create())).rejects.toMatchObject({ status: 403 });
    expect(f.assets.size).toBe(0);
  });
  it("rolls back registration if the identifier cannot be saved", async () => {
    const f = fixture(), original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, p) => { if (sql.startsWith("INSERT INTO asset_aliases")) throw Object.assign(new Error("Duplicate"), { code: "23505" }); return original(sql, p); });
    await expect(f.service.createFleetAsset(actor, create())).rejects.toBeTruthy();
    expect(f.assets.size).toBe(0); expect(f.state().fleets[0].equipmentAssetIds).toEqual([]);
  });
  it("adds an existing asset without creating a second Inventory record or clearing its status", async () => {
    const f = fixture(); f.assets.set(assetId, { id: assetId, version: 3, status: "held", category: "trailer", responsible_org_type: "vendor", responsible_org_id: 7 });
    await f.service.enrollFleetAsset(actor, assetId, { operationId: randomUUID(), expectedVersion: 3 });
    expect(f.assets.size).toBe(1); expect(f.assets.get(assetId)?.status).toBe("held");
    expect(f.state().fleets[0].equipmentAssetIds).toEqual([]);
  });
  it("refuses foreign-company and non-vehicle inventory", async () => {
    const f = fixture(), body = { operationId: randomUUID(), expectedVersion: 1 };
    f.assets.set(assetId, { id: assetId, version: 1, category: "truck", responsible_org_type: "vendor", responsible_org_id: 8 });
    await expect(f.service.enrollFleetAsset(actor, assetId, body)).rejects.toMatchObject({ status: 404 });
    f.assets.get(assetId)!.responsible_org_id = 7; f.assets.get(assetId)!.category = "radio";
    await expect(f.service.enrollFleetAsset(actor, assetId, body)).rejects.toMatchObject({ code: "fleet.asset_type_required" });
  });
  it("never lets a driver create or enroll assets", async () => {
    const f = fixture(); await expect(f.service.createFleetAsset({ ...actor, userId: 2, role: "field_employee", membershipRole: "field_employee" }, create())).rejects.toMatchObject({ status: 403 });
    expect(f.assets.size).toBe(0);
  });
});
