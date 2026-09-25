import { beforeEach, expect, it, vi } from "vitest";
import type { AssetRecord } from "./assets";

const state = vi.hoisted(() => ({ stagedUpdate: false, committed: false, rolledBack: false, evidenceWrites: 0, eventWrites: 0, eventPayload: null as Record<string, unknown> | null }));
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: {
    select: () => ({ from: (table: unknown) => {
      const query = {
        where() { return this; },
        orderBy: async () => [],
        limit: async () => table === original.assetsTable ? [{ id: "asset-2", name: "Radio", category: "equipment", legalOwnerName: "Vendor", responsibleOrgType: "vendor", responsibleOrgId: 7, provisional: false, status: "checked_out", currentHolderUserId: 11, currentLocationType: "user", currentLocationId: "11", expectedReturnAt: null, version: 2, manufacturer: null, model: null, mergedIntoId: null }] : [],
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
      };
      return query;
    } }),
    transaction: async (work: (tx: any) => Promise<unknown>) => {
      const tx = {
        update: () => ({ set: () => ({ where: () => ({ returning: async () => { state.stagedUpdate = true; return [{ id: "asset-2" }]; } }) }) }),
        select: () => ({ from: () => ({ where: async () => [] }) }),
        insert: (table: unknown) => ({ values: (payload: Record<string, unknown>) => {
          if (table === original.assetCustodyEventsTable) {
            state.eventWrites++;
            state.eventPayload = payload;
            return { onConflictDoNothing: () => ({ returning: async () => [] }) };
          }
          if (table === original.assetConditionEvidenceTable) state.evidenceWrites++;
          return Promise.resolve();
        } }),
      };
      try {
        const result = await work(tx);
        state.committed = true;
        return result;
      } catch (error) {
        state.rolledBack = true;
        throw error;
      }
    },
  } };
});
import { databaseAssetRepository } from "./asset-database-repository";

beforeEach(() => { state.stagedUpdate = false; state.committed = false; state.rolledBack = false; state.evidenceWrites = 0; state.eventWrites = 0; state.eventPayload = null; });

it("rolls back a CAS update when an operation ID already belongs to another asset", async () => {
  const asset: AssetRecord = {
    id: "asset-2", name: "Radio", category: "equipment", legalOwner: "Vendor",
    responsibleOwner: { type: "vendor", id: 7 }, aliases: [], provisional: false,
    status: "checked_out", holderUserId: 11, version: 1,
    history: [{ id: "33333333-3333-4333-8333-333333333333", type: "checkout", actorUserId: 11, toHolderUserId: 11, condition: "good", commandFingerprint: "same-command", photos: ["https://example.test/photo.jpg"], occurredAt: new Date("2026-09-24T12:00:00Z") }],
  };
  await expect(databaseAssetRepository.save(asset, 1)).rejects.toMatchObject({ code: "asset.operation_reused" });
  expect(state.stagedUpdate).toBe(true);
  expect(state.eventWrites).toBe(1);
  expect(state.eventPayload).toMatchObject({ commandFingerprint: "same-command", assetId: "asset-2" });
  expect(state.rolledBack).toBe(true);
  expect(state.committed).toBe(false);
  expect(state.evidenceWrites).toBe(0);
});
