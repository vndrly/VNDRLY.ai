import { describe, expect, it } from "vitest";
import {
  canTransferAsset,
  assetTransferReceipt,
  readTransferRecipients,
} from "./asset-transfer-access";
import type { AssetRecord } from "./assets";
const asset = {
  id: "11111111-1111-4111-8111-111111111111",
  responsibleOwner: { type: "vendor", id: 7 },
  status: "checked_out",
  holderUserId: 11,
  version: 4,
  history: [],
} as unknown as AssetRecord;
const actor = {
  userId: 11,
  owner: asset.responsibleOwner,
  isPlatformAdmin: false,
  isAssetManager: false,
  isGateSupervisor: false,
  canCheckOutAsset: true,
};
describe("exact Inventory transfer access", () => {
  it("allows only current scoped holder or canonical manager/supervisor for transferable custody", () => {
    expect(canTransferAsset(actor, asset)).toBe(true);
    expect(canTransferAsset({ ...actor, userId: 12 }, asset)).toBe(false);
    expect(canTransferAsset({ ...actor, canCheckOutAsset: false }, asset)).toBe(
      false,
    );
    expect(
      canTransferAsset({ ...actor, userId: 12, isAssetManager: true }, asset),
    ).toBe(true);
    expect(
      canTransferAsset({ ...actor, owner: { type: "vendor", id: 8 } }, asset),
    ).toBe(false);
    for (const status of ["held", "retired", "merged", "available"] as const)
      expect(canTransferAsset(actor, { ...asset, status })).toBe(false);
  });
  it("queries only exact owner active recipients with bounded public projection", async () => {
    let sql = "",
      values: unknown[] = [];
    const recipients = await readTransferRecipients(
      {
        query: async (text, parameters) => {
          sql = text;
          values = parameters ?? [];
          return { rows: [{ user_id: 12, display_name: "Coworker" }] };
        },
      },
      asset,
    );
    expect(values).toEqual(["vendor", 7, 11]);
    expect(sql).toContain("suspended_at IS NULL");
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("LIMIT 51");
    expect(recipients).toEqual({
      recipients: [{ userId: 12, displayName: "Coworker" }],
      truncated: false,
    });
  });
  it("reads only the exact actor's saved transfer and never invents absent receipt", () => {
    const op = "22222222-2222-4222-8222-222222222222";
    const saved = {
      ...asset,
      history: [
        {
          id: op,
          type: "transfer" as const,
          actorUserId: 11,
          fromHolderUserId: 11,
          toHolderUserId: 12,
          condition: "good" as const,
          commandFingerprint: "a".repeat(64),
          occurredAt: new Date("2026-10-07T10:00:00Z"),
        },
      ],
    };
    expect(assetTransferReceipt(saved, op, 11)).toMatchObject({
      operationId: op,
      actorUserId: 11,
      physicalHandoffVerified: false,
    });
    expect(assetTransferReceipt(saved, op, 12)).toBeNull();
    expect(assetTransferReceipt(asset, op, 11)).toBeNull();
  });
});
