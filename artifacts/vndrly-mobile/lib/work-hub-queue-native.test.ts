import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const rows = new Map<string, string>();
  const calls: string[] = [];
  const db = {
    execAsync: vi.fn(async (sql: string) => { calls.push(sql); }),
    getFirstAsync: vi.fn(async (_sql: string, key: string) => rows.has(key) ? { value: rows.get(key) } : null),
    runAsync: vi.fn(async (_sql: string, key: string, value: string) => { rows.set(key, value); }),
  };
  return {
    rows, calls, db,
    open: vi.fn(async () => db),
    secureGet: vi.fn(async () => null as string | null),
    secureSet: vi.fn(async () => undefined),
    random: vi.fn(async () => Uint8Array.from(Array.from({ length: 32 }, (_, index) => index))),
  };
});

vi.mock("expo-sqlite", () => ({ openDatabaseAsync: mocks.open }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: mocks.secureGet,
  setItemAsync: mocks.secureSet,
}));
vi.mock("expo-crypto", () => ({ getRandomBytesAsync: mocks.random }));

describe("native encrypted Work Hub queue store", () => {
  beforeEach(async () => {
    mocks.rows.clear(); mocks.calls.length = 0;
    vi.clearAllMocks();
    const module = await import("./work-hub-queue-native");
    module.__resetNativeWorkHubQueueForTests();
  });

  it("enables SQLCipher in Expo's native build configuration", () => {
    const app = JSON.parse(readFileSync("app.json", "utf8"));
    expect(app.expo.plugins).toContainEqual(["expo-sqlite", { useSQLCipher: true }]);
  });

  it("stores a random database key in device-only secure storage and applies it before schema access", async () => {
    const { getNativeWorkHubQueueStore } = await import("./work-hub-queue-native");
    const store = await getNativeWorkHubQueueStore();
    expect(mocks.secureSet).toHaveBeenCalledWith(
      "vndrly.workHub.queue.databaseKey.v1",
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      { keychainAccessible: "device-only" },
    );
    expect(mocks.calls[0]).toContain("PRAGMA key");
    expect(mocks.calls[0]).toContain("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    expect(mocks.calls[1]).toContain("CREATE TABLE IF NOT EXISTS work_hub_queue_store");
    await store.setItem("scope", "private value");
    await expect(store.getItem("scope")).resolves.toBe("private value");
  });

  it("reuses an existing encryption key without regenerating it", async () => {
    mocks.secureGet.mockResolvedValueOnce("aabbcc".repeat(10) + "aabb");
    const { getNativeWorkHubQueueStore } = await import("./work-hub-queue-native");
    await getNativeWorkHubQueueStore();
    expect(mocks.random).not.toHaveBeenCalled();
    expect(mocks.secureSet).not.toHaveBeenCalled();
    expect(mocks.calls[0]).toContain("aabbcc".repeat(10) + "aabb");
  });
});
