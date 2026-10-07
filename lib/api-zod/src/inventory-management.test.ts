import { expect, it } from "vitest";
import {
  InventoryPolicyCommandSchema,
  InventoryMergeCommandSchema,
  InventoryManagementReceiptSchema,
} from "./inventory-management";
const operationId = "00000000-0000-4000-8000-000000000001",
  policy = {
    identifierRequired: true,
    photosRequiredOnCheckout: false,
    photosRequiredOnReturn: false,
    supervisorApprovalRequired: false,
    expectedReturnRequired: true,
  };
it("requires explicit reviewed fields; initial policy revision zero never becomes an asset CAS", () => {
  const p = { operationId, expectedVersion: 0, confirmed: true, policy };
  expect(InventoryPolicyCommandSchema.safeParse(p).success).toBe(true);
  for (const raw of [
    { ...p, owner: { type: "vendor", id: 9 } },
    { ...p, confirmed: false },
    { ...p, policy: { identifierRequired: true } },
  ])
    expect(InventoryPolicyCommandSchema.safeParse(raw).success).toBe(false);
  expect(
    InventoryMergeCommandSchema.safeParse({
      operationId,
      expectedVersion: 0,
      mergedAssetId: operationId,
      mergedExpectedVersion: 1,
      reason: "Actual reason",
      confirmed: true,
    }).success,
  ).toBe(false);
});
it("requires complete action-specific receipts and false physical/legal proof flags", () => {
  const r = {
    operationId,
    actorUserId: 3,
    owner: { type: "vendor", id: 7 },
    action: "policy",
    targetId: "truck",
    commandFingerprint: "a".repeat(64),
    previousVersion: 0,
    version: 1,
    policy,
    previousPolicy: policy,
    recordedAt: "2026-10-07T12:00:00.000Z",
    status: "applied",
    physicalPossessionVerified: false,
    legalOwnershipVerified: false,
  };
  expect(InventoryManagementReceiptSchema.safeParse(r).success).toBe(true);
  for (const raw of [
    { ...r, previousPolicy: undefined },
    { ...r, physicalPossessionVerified: true },
    { ...r, legalOwnershipVerified: true },
    { ...r, action: "merge" },
    { ...r, privateFileUrl: "private" },
  ])
    expect(InventoryManagementReceiptSchema.safeParse(raw).success).toBe(false);
});
