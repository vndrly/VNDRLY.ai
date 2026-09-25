import { describe, expect, it, vi } from "vitest";
import { createAssetService, createMemoryAssetRepository } from "./assets";

describe("Implementation A asset custody", () => {
  it("finds a vehicle by its current or historical plate alias", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const asset = await service.createAsset({ name: "Fleet 12", category: "vehicle", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [{ kind: "vin", value: "1M8GDM9AXKP042788" }, { kind: "plate", jurisdiction: "TX", value: "ABC123" }] });
    await service.addAlias(asset.id, { kind: "plate", jurisdiction: "TX", value: "NEW456" }, asset.version);
    expect(await service.findAsset({ kind: "plate", jurisdiction: "TX", value: "ABC123" })).toMatchObject({ id: asset.id });
    expect(await service.findAsset({ kind: "plate", jurisdiction: "TX", value: "NEW456" })).toMatchObject({ id: asset.id });
  });

  it("rejects simultaneous custody transfer with a stale version", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const asset = await service.createAsset({ name: "Radio kit", category: "electronics", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [] });
    expect(await service.checkoutAsset({ assetId: asset.id, holderUserId: 7, condition: "good", confirmed: true, expectedVersion: 1 })).toMatchObject({ status: "applied", version: 2 });
    expect(await service.checkoutAsset({ assetId: asset.id, holderUserId: 8, condition: "good", confirmed: true, expectedVersion: 1 })).toMatchObject({ status: "conflict" });
  });

  it("creates a provisional asset for an unknown identifier", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const result = await service.findOrCreateProvisional({ identifier: { kind: "plate", jurisdiction: "TX", value: "ZZZ999" }, responsibleOwner: { type: "vendor", id: 20 } });
    expect(result).toMatchObject({ provisional: true, aliases: [{ kind: "plate", jurisdiction: "TX", value: "ZZZ999" }] });
  });

  it("blocks checkout while an asset is held", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const asset = await service.createAsset({ name: "Television", category: "electronics", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [] });
    await service.placeAssetHold({ assetId: asset.id, reason: "damage_review", expectedVersion: 1 });
    expect(await service.checkoutAsset({ assetId: asset.id, holderUserId: 7, condition: "fair", confirmed: true, expectedVersion: 2 })).toMatchObject({ status: "blocked", code: "asset.on_hold" });
  });

  it("replays a custody operation without duplicating history or advancing version", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const asset = await service.createAsset({ name: "Radio", category: "equipment", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [] });
    const input = { assetId: asset.id, holderUserId: 7, actorUserId: 7, operationId: "11111111-1111-4111-8111-111111111111", condition: "good" as const, confirmed: true, expectedVersion: 1 };
    expect(await service.checkoutAsset(input)).toMatchObject({ status: "applied", version: 2 });
    expect(await service.checkoutAsset(input)).toMatchObject({ status: "applied", version: 2, asset: { history: [{ id: input.operationId }] } });
    expect(await service.checkoutAsset({ ...input, holderUserId: 8 })).toMatchObject({ status: "conflict", code: "asset.operation_reused" });
  });

  it("replays a return after the holder has already been cleared", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const asset = await service.createAsset({ name: "Radio", category: "equipment", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [] });
    await service.checkoutAsset({ assetId: asset.id, holderUserId: 7, condition: "good", confirmed: true, expectedVersion: 1 });
    const input = { assetId: asset.id, holderUserId: 7, actorUserId: 7, operationId: "22222222-2222-4222-8222-222222222222", condition: "good" as const, confirmed: true, expectedVersion: 2 };
    expect(await service.returnAsset(input)).toMatchObject({ status: "applied", version: 3 });
    expect(await service.returnAsset(input)).toMatchObject({ status: "applied", version: 3 });
  });

  it("compares the complete custody command before accepting a replay", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const asset = await service.createAsset({ name: "Radio", category: "equipment", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [] });
    const input = { assetId: asset.id, holderUserId: 7, actorUserId: 7, operationId: "33333333-3333-4333-8333-333333333333", condition: "good" as const, confirmed: true, expectedVersion: 1, note: "Issued clean", photos: ["https://example.test/first.jpg"], expectedReturnAt: new Date("2026-10-01T12:00:00Z") };
    expect(await service.checkoutAsset(input)).toMatchObject({ status: "applied" });
    expect(await service.checkoutAsset(input)).toMatchObject({ status: "applied", version: 2 });
    for (const changed of [
      { ...input, note: "Changed note" },
      { ...input, photos: ["https://example.test/second.jpg"] },
      { ...input, expectedReturnAt: new Date("2026-10-02T12:00:00Z") },
      { ...input, holderUserId: 8 },
      { ...input, condition: "fair" as const },
    ]) expect(await service.checkoutAsset(changed)).toMatchObject({ status: "conflict", code: "asset.operation_reused" });
  });

  it("holds damaged verified equipment and preserves the hold on return", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const asset = await service.createAsset({ name: "Radio", category: "equipment", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [] });
    await service.checkoutAsset({ assetId: asset.id, holderUserId: 7, condition: "good", confirmed: true, expectedVersion: 1 });
    const verified = await service.verifyIssuedAsset({ assetId: asset.id, actorUserId: 7, operationId: "44444444-4444-4444-8444-444444444444", condition: "damaged", confirmed: true, expectedVersion: 2 });
    expect(verified).toMatchObject({ status: "applied", asset: { status: "held" } });
    expect(await service.verifyIssuedAsset({ assetId: asset.id, actorUserId: 7, operationId: "55555555-5555-4555-8555-555555555555", condition: "good", confirmed: true, expectedVersion: 3 })).toMatchObject({ status: "blocked", code: "asset.on_hold" });
    expect(await service.transferAsset({ assetId: asset.id, fromHolderUserId: 7, toHolderUserId: 8, condition: "good", confirmed: true, expectedVersion: 3 })).toMatchObject({ status: "blocked", code: "asset.on_hold" });
    expect(await service.returnAsset({ assetId: asset.id, holderUserId: 7, condition: "good", confirmed: true, expectedVersion: 3 })).toMatchObject({ status: "applied", asset: { status: "held" } });
  });

  it("moves the existing location columns on transfer and clears them on return", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const asset = await service.createAsset({ name: "Radio", category: "equipment", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [] });
    await service.checkoutAsset({ assetId: asset.id, holderUserId: 7, condition: "good", confirmed: true, expectedVersion: 1 });
    const transferred = await service.transferAsset({ assetId: asset.id, fromHolderUserId: 7, toHolderUserId: 8, condition: "good", confirmed: true, expectedVersion: 2 });
    expect(transferred).toMatchObject({ status: "applied", asset: { holderUserId: 8, currentLocationType: "user", currentLocationId: "8", currentLocation: "user:8" } });
    const returned = await service.returnAsset({ assetId: asset.id, holderUserId: 8, condition: "good", confirmed: true, expectedVersion: 3 });
    expect(returned).toMatchObject({ status: "applied", asset: { currentLocationType: null, currentLocationId: null, currentLocation: null } });
  });

  it("merges only with Asset Manager authority and retains both histories", async () => {
    const service = createAssetService(createMemoryAssetRepository());
    const first = await service.createAsset({ name: "Truck", category: "vehicle", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [{ kind: "plate", jurisdiction: "TX", value: "ABC123" }] });
    const duplicate = await service.createAsset({ name: "Truck provisional", category: "vehicle", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [{ kind: "vin", value: "1M8GDM9AXKP042788" }], provisional: true });
    await service.checkoutAsset({ assetId: duplicate.id, holderUserId: 7, condition: "good", confirmed: true, expectedVersion: 1 });
    await expect(service.mergeAssets({ survivingAssetId: first.id, mergedAssetId: duplicate.id, actorRoles: [], reason: "duplicate" })).rejects.toMatchObject({ code: "asset.asset_manager_required" });
    const merged = await service.mergeAssets({ survivingAssetId: first.id, mergedAssetId: duplicate.id, actorRoles: ["asset_manager"], reason: "duplicate" });
    expect(merged.history.map((event) => event.type)).toEqual(["checkout", "merge"]);
    expect(await service.findAsset({ kind: "vin", value: "1M8GDM9AXKP042788" })).toMatchObject({ id: first.id });
  });

  it("does not reinsert an existing custody operation while merging database assets", async () => {
    const repository = createMemoryAssetRepository();
    const service = createAssetService(repository);
    const first = await service.createAsset({ name: "Truck", category: "vehicle", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [] });
    const duplicate = await service.createAsset({ name: "Duplicate", category: "vehicle", legalOwner: "MidCon", responsibleOwner: { type: "vendor", id: 20 }, aliases: [] });
    await service.checkoutAsset({ assetId: duplicate.id, holderUserId: 7, condition: "good", confirmed: true, expectedVersion: 1 });
    const foreignEventId = (await repository.get(duplicate.id))!.history[0]!.id;
    const save = repository.save.bind(repository);
    repository.save = async (asset, expectedVersion) => {
      if (asset.id === first.id && asset.history.some((event) => event.id === foreignEventId)) throw new Error("foreign custody operation inserted twice");
      return save(asset, expectedVersion);
    };
    const recordMerge = vi.fn(async () => undefined);
    repository.recordMerge = recordMerge;
    await expect(service.mergeAssets({ survivingAssetId: first.id, mergedAssetId: duplicate.id, actorRoles: ["asset_manager"], reason: "duplicate" })).resolves.toMatchObject({ id: first.id });
    expect(recordMerge).toHaveBeenCalledOnce();
  });
});
