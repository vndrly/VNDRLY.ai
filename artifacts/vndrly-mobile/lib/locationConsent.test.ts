import { beforeEach, describe, expect, it, vi } from "vitest";

// Simulate native (no `window.localStorage`) by leaving globalThis.window unset.
// The module under test prefers SecureStore in that case.
const store = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => (store.has(k) ? store.get(k)! : null),
  setItemAsync: async (k: string, v: string) => {
    store.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    store.delete(k);
  },
}));

// Avoid pulling in real network / device id deps when the module is imported.
vi.mock("./api", () => ({ apiFetch: vi.fn() }));
vi.mock("./deviceId", () => ({ getDeviceId: async () => "device-test" }));

describe("locationConsent — declined-flag persistence (SecureStore-backed)", () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
    // Make sure no DOM env leaks in.
    delete (globalThis as any).window;
  });

  it("persists 'declined' across simulated app relaunch", async () => {
    const first = await import("./locationConsent");
    expect(await first.isConsentDeclined()).toBe(false);
    await first.setConsentDeclined(true);
    expect(await first.isConsentDeclined()).toBe(true);

    // Simulate relaunch: throw away module cache. The new module instance has
    // no in-memory state, so the only way to remember the choice is to read
    // it back out of SecureStore.
    vi.resetModules();
    const reloaded = await import("./locationConsent");
    expect(await reloaded.isConsentDeclined()).toBe(true);
  });

  it("clears the 'declined' flag when set back to false", async () => {
    const mod = await import("./locationConsent");
    await mod.setConsentDeclined(true);
    expect(await mod.isConsentDeclined()).toBe(true);
    await mod.setConsentDeclined(false);
    expect(await mod.isConsentDeclined()).toBe(false);

    // And the cleared state also persists across relaunch.
    vi.resetModules();
    const reloaded = await import("./locationConsent");
    expect(await reloaded.isConsentDeclined()).toBe(false);
  });

  it("writes the flag to the SecureStore key the app expects", async () => {
    const mod = await import("./locationConsent");
    await mod.setConsentDeclined(true);
    expect(store.get("vndrly.locationConsentDeclined")).toBe("1");
  });
});
