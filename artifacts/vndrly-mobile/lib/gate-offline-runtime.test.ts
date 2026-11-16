import { beforeEach, expect, it, vi } from "vitest";
import { readOfflineGate, refreshOfflineGate, saveOfflineGate } from "./gate-offline-runtime";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), sync: vi.fn(), values: new Map<string, string>(), current: vi.fn(() => true) }));
vi.mock("./api", () => ({ apiFetch: mocks.fetch }));
vi.mock("./auth", () => ({ captureAuthScope: () => ({}), isAuthScopeCurrent: mocks.current }));
vi.mock("./native-operation-journal-runtime", () => ({ nativeJournalScope: (u: any) => ({ userId: u.id, membershipId: u.activeMembershipId, orgType: "vendor", orgId: u.vendorId }), synchronizeNativeJournal: mocks.sync }));
vi.mock("./work-hub-queue-native", () => ({ getNativeWorkHubQueueStore: async () => ({ getItem: async (k: string) => mocks.values.get(k) ?? null, setItem: async (k: string, v: string) => { mocks.values.set(k, v); } }) }));
const user = { id: 1, activeMembershipId: 2, vendorId: 3 } as any;
const snapshot = { siteId: 1, siteName: "Synthetic site", stationId: "00000000-0000-4000-8000-000000000001", stationName: "Synthetic gate", capturedAt: Date.now() - 7200_000, visits: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.values.clear(); mocks.current.mockReturnValue(true); });
it("retains the gate across a two-hour server outage and isolates account caches", async () => {
  await saveOfflineGate(user, snapshot);
  mocks.fetch.mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
  await expect(refreshOfflineGate(user, snapshot)).rejects.toThrow("down");
  expect(await readOfflineGate(user)).toMatchObject(snapshot);
  expect(await readOfflineGate({ ...user, activeMembershipId: 4 })).toBeNull();
  expect(mocks.sync).not.toHaveBeenCalled();
});
it("does not discard cached facts or claim current access after a server refusal", async () => {
  await saveOfflineGate(user, snapshot);
  mocks.fetch.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
  await expect(refreshOfflineGate(user, snapshot)).rejects.toMatchObject({ status: 403 });
  expect(await readOfflineGate(user)).toMatchObject(snapshot);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it("refreshes a complete roster then retries the journal on recovery", async () => {
  await saveOfflineGate(user, snapshot); mocks.fetch.mockResolvedValue([]); mocks.sync.mockResolvedValue([]);
  await refreshOfflineGate(user, snapshot);
  expect(await readOfflineGate(user)).toMatchObject({ complete: true, visits: [] });
  expect(mocks.sync).toHaveBeenCalledWith(user);
});
it("does not replace a newly selected gate with an older inflight response", async () => {
  await saveOfflineGate(user, snapshot);
  mocks.fetch.mockImplementation(async () => {
    await saveOfflineGate(user, { ...snapshot, stationId: "00000000-0000-4000-8000-000000000002", capturedAt: Date.now() });
    return [];
  });
  await refreshOfflineGate(user, snapshot);
  expect((await readOfflineGate(user))?.stationId).toContain("000000000002");
  expect(mocks.sync).not.toHaveBeenCalled();
});
