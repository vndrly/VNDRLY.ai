import { beforeEach, expect, it, vi } from "vitest";
import { createAssetService, type AssetRecord } from "./assets";

const state = vi.hoisted(() => ({ stagedUpdate: false, committed: false, rolledBack: false, evidenceWrites: 0, eventWrites: 0, eventPayload: null as Record<string, unknown> | null,
  acceptAlias: false, aliasConflict: null as Record<string, unknown> | null,
  acceptEvents: false, savedFields: {} as Record<string, unknown>, events: [] as Record<string, unknown>[], evidence: [] as Record<string, unknown>[], holds: [] as Record<string, unknown>[],
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: {
    select: () => ({ from: (table: unknown) => {
      const query = {
        where() { return this; },
        orderBy: async () => table === original.assetCustodyEventsTable ? state.events : table === original.assetConditionEvidenceTable ? state.evidence : [],
        limit: async () => table === original.assetsTable ? [{ id: "asset-2", name: "Radio", category: "equipment", legalOwnerName: "Vendor", responsibleOrgType: "vendor", responsibleOrgId: 7, provisional: false, status: "checked_out", currentHolderUserId: 11, currentLocationType: "user", currentLocationId: "11", expectedReturnAt: null, version: 2, manufacturer: null, model: null, mergedIntoId: null, ...state.savedFields }] : table === original.assetHoldsTable ? state.holds : [],
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
      };
      return query;
    } }),
    transaction: async (work: (tx: any) => Promise<unknown>) => {
      const tx = {
        update: () => ({ set: (fields: Record<string, unknown>) => ({ where: () => ({ returning: async () => { state.stagedUpdate = true; if (state.acceptEvents) state.savedFields = fields; return [{ id: "asset-2" }]; } }) }) }),
        select: () => ({ from: () => ({ where: async () => state.events.map(event => ({ id: event.id })) }) }),
        insert: (table: unknown) => ({ values: (payload: Record<string, unknown>) => {
          if (table === original.assetAliasesTable) return { onConflictDoUpdate: (conflict: Record<string, unknown>) => { state.aliasConflict = conflict; return { returning: async () => state.acceptAlias ? [{ id: "alias" }] : [] }; } };
          if (table === original.assetCustodyEventsTable) {
            state.eventWrites++;
            state.eventPayload = payload;
            return { onConflictDoNothing: () => ({ returning: async () => { if (!state.acceptEvents) return []; state.events.push(payload); return [{ id: payload.id }]; } }) };
          }
          if (table === original.assetConditionEvidenceTable) { state.evidenceWrites++; state.evidence.push(payload); }
          if (table === original.assetHoldsTable) state.holds.push(payload);
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

it("rolls back a concurrent identifier collision without reassigning its owner", async () => {
  state.acceptAlias = false;
  const asset = (await databaseAssetRepository.get("asset-2"))!;
  asset.aliases = [{ kind: "serial", value: "FOREIGN-SERIAL" }];
  await expect(databaseAssetRepository.save(asset, asset.version)).rejects.toMatchObject({ code: "asset.identifier_in_use" });
  expect(state.aliasConflict).toMatchObject({ set: { displayValue: "FOREIGN-SERIAL", active: true } });
  expect(state.aliasConflict?.setWhere).toBeTruthy();
  expect((state.aliasConflict?.set as Record<string, unknown>).assetId).toBeUndefined();
  expect(state.rolledBack).toBe(true);
  expect(state.committed).toBe(false);
});
import { databaseAssetRepository } from "./asset-database-repository";

beforeEach(() => { state.stagedUpdate = false; state.committed = false; state.rolledBack = false; state.evidenceWrites = 0; state.eventWrites = 0; state.eventPayload = null; state.acceptEvents = false; state.savedFields = {}; state.events = []; state.evidence = []; state.holds = []; });

it("preserves the latest reported condition and authenticated hold actor after saving and reloading", async () => {
  state.acceptEvents = true;
  const service = createAssetService(databaseAssetRepository);
  await service.reportAssetCondition({ assetId: "asset-2", condition: "fair", expectedVersion: 2 });
  await service.reportAssetCondition({ assetId: "asset-2", condition: "good", expectedVersion: 3 });
  const held = await service.placeAssetHold({ assetId: "asset-2", reason: "Inspect before reissue", expectedVersion: 4, actorUserId: 13 });
  expect(state.evidence.map(row => row.condition)).toEqual(["fair", "good", "not_reported"]);
  expect(held).toMatchObject({ status: "held", condition: "good", hold: "Inspect before reissue", version: 5 });
  const reloaded = await databaseAssetRepository.get("asset-2");
  expect(reloaded).toMatchObject({ status: "held", condition: "good", version: 5 });
  expect(reloaded!.history.at(-1)).toMatchObject({ type: "hold", actorUserId: 13, note: "Inspect before reissue" });
  expect(state.eventPayload).toMatchObject({ eventType: "hold", actorUserId: 13 });
});

it("keeps condition unknown when all saved evidence is note-only", async () => {
  state.acceptEvents = true;
  await createAssetService(databaseAssetRepository).placeAssetHold({ assetId: "asset-2", reason: "Awaiting inspection", expectedVersion: 2, actorUserId: 13 });
  expect((await databaseAssetRepository.get("asset-2"))!.condition).toBeNull();
  expect(state.evidence[0]).toMatchObject({ condition: "not_reported" });
});

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
