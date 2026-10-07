import { describe, it, expect, vi } from "vitest";
import {
  makeTransferAttempt,
  submitTransferAttempt,
} from "./inventory-transfer";
const assetId = "11111111-1111-4111-8111-111111111111",
  operationId = "22222222-2222-4222-8222-222222222222";
const input = {
  operationId,
  expectedVersion: 4,
  toHolderUserId: 8,
  condition: "good",
  confirmed: true,
  photos: [],
};
const receipt = {
  assetId,
  operationId,
  actorUserId: 7,
  fromHolderUserId: 7,
  toHolderUserId: 8,
  condition: "good",
  commandFingerprint: "a".repeat(64),
  recordedAt: "2026-10-07T15:00:00Z",
  physicalHandoffVerified: false,
};
describe("exact native inventory transfer", () => {
  it("recovers saved original event without treating later version as original receipt", async () => {
    const a = makeTransferAttempt(assetId, input, 7, 7, "a".repeat(64));
    const api = vi.fn().mockResolvedValue({ receipt, currentVersion: 12 });
    await expect(submitTransferAttempt(a, api, () => true)).resolves.toEqual(
      receipt,
    );
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][0]).toContain("/transfers/" + operationId);
  });
  it("posts immutable body only after canonical authorized absent operation", async () => {
    const a = makeTransferAttempt(assetId, input, 7, 7, "a".repeat(64));
    const api = vi
      .fn()
      .mockResolvedValueOnce({ receipt: null, currentVersion: 4 })
      .mockResolvedValueOnce({ status: "applied", version: 5 })
      .mockResolvedValueOnce({ receipt, currentVersion: 5 });
    await submitTransferAttempt(a, api, () => true);
    expect(api.mock.calls[1][1].body).toBe(a.body);
    expect(api).toHaveBeenCalledTimes(3);
  });
  it("never resends on denied readback and refuses changed account or altered event", async () => {
    const a = makeTransferAttempt(assetId, input, 7, 7, "a".repeat(64));
    const denied = vi.fn().mockRejectedValue({ status: 403 });
    await expect(
      submitTransferAttempt(a, denied, () => true),
    ).rejects.toBeDefined();
    expect(denied).toHaveBeenCalledTimes(1);
    await expect(
      submitTransferAttempt(
        a,
        async () => ({
          receipt: { ...receipt, toHolderUserId: 9 },
          currentVersion: 5,
        }),
        () => true,
      ),
    ).rejects.toThrow();
    await expect(
      submitTransferAttempt(a, vi.fn(), () => false),
    ).rejects.toThrow();
  });
  it("stops before POST when exact operation is absent at a changed canonical version", async () => {
    const api = vi.fn().mockResolvedValue({ receipt: null, currentVersion: 8 });
    await expect(
      submitTransferAttempt(
        makeTransferAttempt(assetId, input, 7, 7, "a".repeat(64)),
        api,
        () => true,
      ),
    ).rejects.toThrow("Original transfer absent");
    expect(api).toHaveBeenCalledTimes(1);
  });
});
