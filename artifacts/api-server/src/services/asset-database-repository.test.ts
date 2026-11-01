import { beforeEach, expect, it, vi } from "vitest";
import { createAssetService, type AssetRecord } from "./assets";

const state = vi.hoisted(() => ({ stagedUpdate: false, committed: false, rolledBack: false, evidenceWrites: 0, eventWrites: 0, eventPayload: null as Record<string, unknown> | null,
  acceptAlias: false, aliasConflict: null as Record<string, unknown> | null,
  acceptEvents: false, savedFields: {} as Record<string, unknown>, events: [] as Record<string, unknown>[], evidence: [] as Record<string, unknown>[], holds: [] as Record<string, unknown>[],
  currentVersion: 2, initialProfile: null as Record<string, unknown> | null, telemetry: null as Record<string, unknown> | null,
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
        execute: async (statement: { queryChunks: { value?: unknown }[] }) => {
          const text = statement.queryChunks.map(chunk => String(chunk.value ?? "")).join("");
          if (text.includes("SELECT audit.tool_output")) return { rows: state.telemetry ? [state.telemetry] : [] };
          return { rows: [{ id: "asset-2", name: "Radio", category: "equipment", legal_owner_name: "Vendor", responsible_org_type: "vendor", responsible_org_id: 7, status: state.savedFields.status ?? "checked_out", version: state.savedFields.version ?? state.currentVersion, current_holder_user_id: state.savedFields.currentHolderUserId === undefined ? 11 : state.savedFields.currentHolderUserId, equipment_profile: state.savedFields.equipmentProfile ?? state.initialProfile }] };
        },
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

beforeEach(() => { state.stagedUpdate = false; state.committed = false; state.rolledBack = false; state.evidenceWrites = 0; state.eventWrites = 0; state.eventPayload = null; state.acceptEvents = false; state.savedFields = {}; state.events = []; state.evidence = []; state.holds = []; state.currentVersion = 2; state.initialProfile = null; state.telemetry = null; });

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
  state.currentVersion = 1;
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

it("synchronizes a legacy inventory return and freezes the genuine prior phone observation", async () => {
  state.acceptEvents = true;
  const observedAt = new Date(Date.now() - 15000).toISOString();
  state.initialProfile = { trackOnMap: true, assignedUserId: 11, ticketId: 45, taskId: "00000000-0000-4000-8000-000000000001", phoneLocationEnabled: true, parentAssetId: null, history: [] };
  state.telemetry = { native_operations: { consent: { locationSharing: true }, designatedDeviceId: "phone", duty: { active: true, mode: "manual", endsAt: null } }, tool_output: { deviceId: "phone", location: { latitude: 35, longitude: -97, accuracy: 5, capturedAt: observedAt } } };
  const result = await createAssetService(databaseAssetRepository).returnAsset({ assetId: "asset-2", holderUserId: 11, actorUserId: 11, operationId: "00000000-0000-4000-8000-000000000002", condition: "good", confirmed: true, expectedVersion: 2 });
  expect(result.status).toBe("applied");
  expect(state.savedFields.equipmentProfile).toMatchObject({ trackOnMap: true, assignedUserId: null, ticketId: null, taskId: null, parentAssetId: null, phoneLocationEnabled: false, location: { latitude: 35, longitude: -97, observedAt, source: "manual", label: "Last known at drop (holder phone)" } });
  expect((state.savedFields.equipmentProfile as { history: unknown[] }).history).toHaveLength(1);
  expect((state.savedFields.equipmentProfile as { history: unknown[] }).history[0]).toMatchObject({ action: "return", assignedUserId: 11, ticketId: 45, taskId: "00000000-0000-4000-8000-000000000001" });
  expect(state.eventPayload).toMatchObject({ eventType: "return", fromHolderUserId: 11, toHolderUserId: null });
});

it("rebinds a legacy transfer to its actual new holder and clears obsolete equipment work context", async () => {
  state.acceptEvents = true;
  state.initialProfile = { trackOnMap: true, assignedUserId: 11, ticketId: 45, taskId: "00000000-0000-4000-8000-000000000001", parentAssetId: "00000000-0000-4000-8000-000000000003", history: [] };
  await createAssetService(databaseAssetRepository).transferAsset({ assetId: "asset-2", fromHolderUserId: 11, toHolderUserId: 12, actorUserId: 13, operationId: "00000000-0000-4000-8000-000000000004", condition: "good", confirmed: true, expectedVersion: 2 });
  expect(state.savedFields.equipmentProfile).toMatchObject({ assignedUserId: 12, ticketId: null, taskId: null, parentAssetId: null, phoneLocationEnabled: true, history: [{ action: "transfer", actorUserId: 13, assignedUserId: 12 }] });
  expect(state.savedFields.currentHolderUserId).toBe(12);
});

it("rebinds a legacy checkout without reviving a returned asset's old task or parent", async () => {
  state.acceptEvents = true;
  state.savedFields = { currentHolderUserId: null, status: "available" };
  state.initialProfile = { trackOnMap: true, assignedUserId: 11, ticketId: 45, parentAssetId: "00000000-0000-4000-8000-000000000003", phoneLocationEnabled: false, history: [] };
  await createAssetService(databaseAssetRepository).checkoutAsset({ assetId: "asset-2", holderUserId: 12, actorUserId: 12, operationId: "00000000-0000-4000-8000-000000000005", condition: "good", confirmed: true, expectedVersion: 2 });
  expect(state.savedFields.equipmentProfile).toMatchObject({ assignedUserId: 12, ticketId: null, taskId: null, parentAssetId: null, phoneLocationEnabled: true, history: [{ action: "checkout", assignedUserId: 12 }] });
});
