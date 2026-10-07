import { expect, it, vi } from "vitest";
import {
  reviewInventoryManagement,
  submitInventoryManagement,
  InventoryManagementAbsentConflict,
} from "./inventory-management-client";
const owner = { type: "vendor", id: 7 } as const,
  operationId = "00000000-0000-4000-8000-000000000001";
const input = {
  operationId,
  expectedVersion: 0,
  confirmed: true as const,
  policy: {
    identifierRequired: true,
    photosRequiredOnCheckout: false,
    photosRequiredOnReturn: false,
    supervisorApprovalRequired: false,
    expectedReturnRequired: true,
  },
};
const attempt = () =>
  reviewInventoryManagement(
    { action: "policy", actorUserId: 3, owner, targetId: "truck", input },
    "a".repeat(64),
  );
const receipt = () => ({
  operationId,
  actorUserId: 3,
  owner,
  targetId: "truck",
  action: "policy",
  commandFingerprint: "a".repeat(64),
  previousVersion: 0,
  version: 1,
  policy: input.policy,
  previousPolicy: input.policy,
  status: "applied",
  recordedAt: "2026-10-07T12:00:00.000Z",
  physicalPossessionVerified: false,
  legalOwnershipVerified: false,
});
it("recovers a dropped saved response before any resend and rejects other actor receipts", async () => {
  let saved = false;
  const api = vi.fn(async (method: string) => {
    if (method !== "GET") {
      saved = true;
      throw Error("Dropped");
    }
    return saved ? { receipt: receipt() } : { receipt: null };
  });
  api
    .mockImplementationOnce(async () => ({ receipt: null }))
    .mockImplementationOnce(async () => ({
      owner,
      category: "truck",
      version: 0,
      policy: input.policy,
    }));
  expect(await submitInventoryManagement(attempt(), api, () => {})).toEqual(
    receipt(),
  );
  expect(api.mock.calls.filter(([m]) => m !== "GET")).toHaveLength(1);
  await expect(
    submitInventoryManagement(
      attempt(),
      async () => ({ receipt: { ...receipt(), actorUserId: 4 } }),
      () => {},
    ),
  ).rejects.toThrow("mismatch");
});
it("denied readback never posts; authoritative absence plus changed version requires explicit new review", async () => {
  const deny = vi.fn(async () => {
    throw Error("Denied");
  });
  await expect(
    submitInventoryManagement(attempt(), deny, () => {}),
  ).rejects.toThrow("Denied");
  expect(deny).toHaveBeenCalledTimes(1);
  const api = vi.fn(async (_m: string, path: string) =>
    path.includes("operations")
      ? { receipt: null }
      : { owner, category: "truck", version: 2, policy: input.policy },
  );
  await expect(
    submitInventoryManagement(attempt(), api, () => {}),
  ).rejects.toBeInstanceOf(InventoryManagementAbsentConflict);
  expect(api.mock.calls.every(([m]) => m === "GET")).toBe(true);
});
it("checks both merge assets before sending and binds recovery to the exact source revision", async () => {
  const targetId = "00000000-0000-4000-8000-000000000002";
  const mergedAssetId = "00000000-0000-4000-8000-000000000003";
  const merge = reviewInventoryManagement(
    {
      action: "merge",
      actorUserId: 3,
      owner,
      targetId,
      input: {
        operationId,
        expectedVersion: 4,
        mergedAssetId,
        mergedExpectedVersion: 7,
        reason: "Duplicate recorded asset",
        confirmed: true,
      },
    },
    "b".repeat(64),
  );
  const saved = {
    operationId,
    actorUserId: 3,
    owner,
    action: "merge",
    targetId,
    commandFingerprint: merge.fingerprint,
    previousVersion: 4,
    version: 5,
    mergedAssetId,
    mergedPreviousVersion: 7,
    mergedVersion: 8,
    recordedAt: "2026-10-07T12:00:00.000Z",
    status: "applied",
    physicalPossessionVerified: false,
    legalOwnershipVerified: false,
  };
  let applied = false;
  const api = vi.fn(async (method: string, path: string, body?: string) => {
    if (path.includes("operations")) return { receipt: applied ? saved : null };
    if (method === "POST") {
      expect(body).toBe(merge.body);
      applied = true;
      throw Error("Lost response");
    }
    return {
      id: path.endsWith(mergedAssetId) ? mergedAssetId : targetId,
      responsibleOwner: owner,
      version: path.endsWith(mergedAssetId) ? 7 : 4,
    };
  });
  expect(await submitInventoryManagement(merge, api, () => {})).toEqual(saved);
  expect(api.mock.calls.filter(([method]) => method === "POST")).toHaveLength(
    1,
  );
  await expect(
    submitInventoryManagement(
      merge,
      async () => ({ receipt: { ...saved, mergedPreviousVersion: 6 } }),
      () => {},
    ),
  ).rejects.toThrow("mismatch");
  const stale = vi.fn(async (_method: string, path: string) =>
    path.includes("operations")
      ? { receipt: null }
      : {
          id: path.endsWith(mergedAssetId) ? mergedAssetId : targetId,
          responsibleOwner: owner,
          version: 4,
        },
  );
  await expect(
    submitInventoryManagement(merge, stale, () => {}),
  ).rejects.toBeInstanceOf(InventoryManagementAbsentConflict);
  expect(stale.mock.calls.every(([method]) => method === "GET")).toBe(true);
});
