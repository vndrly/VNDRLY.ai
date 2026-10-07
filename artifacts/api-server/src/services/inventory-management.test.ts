import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { connect: vi.fn() } }));
import {
  assertMergeableAssets,
  managementFingerprint,
} from "./inventory-management";
import { createAssetService, createMemoryAssetRepository } from "./assets";
const asset = (id = randomUUID()) => ({
  id,
  responsible_org_type: "vendor",
  responsible_org_id: 7,
  version: 2,
  status: "available",
  current_holder_user_id: null,
});
it("requires both exact revisions and same owner; held, lost and issued assets cannot merge", () => {
  const a = asset(),
    b = asset();
  const command = {
    operationId: randomUUID(),
    expectedVersion: 2,
    mergedAssetId: b.id,
    mergedExpectedVersion: 2,
    reason: "Duplicate recorded asset",
    confirmed: true,
  };
  expect(() => assertMergeableAssets(a, b, command)).not.toThrow();
  for (const change of [
    { version: 3 },
    { responsible_org_id: 8 },
    { status: "held" },
    { current_holder_user_id: 12 },
    { status: "merged" },
    { condition: "stolen" },
  ])
    expect(() =>
      assertMergeableAssets(a, { ...b, ...change }, command),
    ).toThrow();
  expect(() =>
    assertMergeableAssets(a, a, { ...command, mergedAssetId: a.id }),
  ).toThrow();
});
it("merged source mutations do not silently redirect a source version to the survivor", async () => {
  const repository = createMemoryAssetRepository(),
    service = createAssetService(repository),
    owner = { type: "vendor", id: 7 } as const;
  const a = await service.createAsset({
      name: "Survivor",
      category: "radio",
      legalOwner: "Synthetic",
      responsibleOwner: owner,
      aliases: [],
    }),
    b = await service.createAsset({
      name: "Source",
      category: "radio",
      legalOwner: "Synthetic",
      responsibleOwner: owner,
      aliases: [],
    });
  await repository.save(
    { ...b, status: "merged", mergedIntoId: a.id },
    b.version,
  );
  await repository.save(a, a.version);
  await expect(
    service.reportAssetCondition({
      assetId: b.id,
      expectedVersion: 2,
      condition: "missing",
    }),
  ).rejects.toHaveProperty("code", "asset.record_read_only");
  expect(await repository.get(a.id)).toMatchObject({
    status: "available",
    version: 2,
    history: [],
  });
});
it("fingerprints bind actor, owner, target, both revisions and reviewed reason", () => {
  const input = {
    operationId: randomUUID(),
    expectedVersion: 2,
    mergedAssetId: randomUUID(),
    mergedExpectedVersion: 4,
    reason: "Reviewed duplicate",
    confirmed: true,
  };
  const base = managementFingerprint(
    "merge",
    3,
    { type: "vendor", id: 7 },
    "asset",
    input,
  );
  for (const args of [
    ["merge", 4, { type: "vendor", id: 7 }, "asset", input],
    ["merge", 3, { type: "vendor", id: 8 }, "asset", input],
    [
      "merge",
      3,
      { type: "vendor", id: 7 },
      "asset",
      { ...input, mergedExpectedVersion: 5 },
    ],
  ] as const)
    expect(
      managementFingerprint(args[0], args[1], args[2], args[3], args[4]),
    ).not.toBe(base);
});
