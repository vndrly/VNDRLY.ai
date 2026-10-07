import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetActionInput } from "@workspace/api-zod";
const records = vi.hoisted(() => new Map<string, string>());
const failure = vi.hoisted(() => ({ suffix: "" }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only", getItemAsync: async (key: string) => records.get(key) ?? null, setItemAsync: async (key: string, value: string) => { if (failure.suffix && key.endsWith(failure.suffix)) throw new Error("Interrupted device write"); records.set(key, value); }, deleteItemAsync: async (key: string) => { records.delete(key); } }));
import { clearFleetOfflineOnSignOut, nativeFleetOffline } from "./fleet-offline-native";
import { fleetOfflineByteLength } from "./fleet-offline";
const scope = { userId: 1, companyId: 2, membershipId: 3 };
beforeEach(() => { records.clear(); failure.suffix = ""; });
describe("Fleet encrypted chunk storage", () => {
  it("retains the prior complete queue after an interrupted generation write and clears abandoned chunks", async () => {
    const first = { runId: "20000000-0000-4000-8000-000000000001", input: { action: "inspect", operationId: "10000000-0000-4000-8000-000000000001", expectedVersion: 1, notes: "Original inspection" } as FleetActionInput, capturedAt: "2026-10-07T12:00:00Z", state: "unsynced" as const };
    await nativeFleetOffline.enqueue(scope, first);
    failure.suffix = ".1.1";
    await expect(nativeFleetOffline.enqueue(scope, { ...first, runId: "20000000-0000-4000-8000-000000000002", input: { ...first.input, operationId: "10000000-0000-4000-8000-000000000002", notes: "New report".repeat(100) } })).rejects.toThrow("Interrupted");
    expect((await nativeFleetOffline.read(scope)).actions).toEqual([first]);
    failure.suffix = "";
    await clearFleetOfflineOnSignOut();
    expect(records.size).toBe(0);
  });
  it("uses bounded chunks and clears every indexed record on sign out", async () => {
    await nativeFleetOffline.enqueue(scope, { runId: "20000000-0000-4000-8000-000000000001", input: { action: "inspect", operationId: "10000000-0000-4000-8000-000000000001", expectedVersion: 1, notes: "中".repeat(1000) } as FleetActionInput, capturedAt: "2026-10-07T12:00:00Z", state: "unsynced" });
    expect(records.size).toBeGreaterThan(3);
    expect([...records.values()].every(value => fleetOfflineByteLength(value) < 2048)).toBe(true);
    expect((await nativeFleetOffline.read(scope)).actions[0].input.notes).toHaveLength(1000);
    await clearFleetOfflineOnSignOut();
    expect(records.size).toBe(0);
  });
  it("refuses oversized unicode records before writing any chunks", async () => {
    const item = (index: number) => ({ runId: `20000000-0000-4000-8000-00000000000${index}`, input: { action: "inspect", operationId: `10000000-0000-4000-8000-00000000000${index}`, expectedVersion: 1, notes: "中".repeat(2000) } as FleetActionInput, capturedAt: "2026-10-07T12:00:00Z", state: "unsynced" as const });
    await nativeFleetOffline.enqueue(scope, item(1)); await nativeFleetOffline.enqueue(scope, item(2));
    const saved = new Map(records);
    await expect(nativeFleetOffline.enqueue(scope, item(3))).rejects.toThrow("16 KB");
    expect(records).toEqual(saved);
  });
});
