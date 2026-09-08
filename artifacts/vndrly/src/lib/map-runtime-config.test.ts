import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runtime map configuration", () => {
  it("loads a public server token when the build did not contain one", async () => {
    vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("VITE_MAPBOX_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mapboxAccessToken: "pk.runtime" }) }));
    const maps = await import("./maps");
    expect(await maps.loadMapboxAccessToken()).toBe("pk.runtime");
    expect(maps.getMapboxStyleTileUrl()).toContain("pk.runtime");
  });
  it("rejects secret tokens from both build and runtime configuration", async () => {
    vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "sk.secret");
    vi.stubEnv("VITE_MAPBOX_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mapboxAccessToken: "sk.secret" }) }));
    const maps = await import("./maps");
    expect(await maps.loadMapboxAccessToken()).toBe("");
    expect(maps.readMapboxAccessToken()).toBe("");
  });
});
