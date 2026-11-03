import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("local training progress comparison selector", () => {
  it("ignores ghost selectors in normal production", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("MODE", "production");
    const { trainingProgressMethod, trainingProgressExperimentsEnabled, effectiveTrainingProgressMethod } = await import("./training-progress-experiment");
    expect(trainingProgressExperimentsEnabled).toBe(false);
    expect(trainingProgressMethod("?progressMethod=render")).toBeNull();
    expect(trainingProgressMethod("?progressBenchmark=1&progressMethod=render")).toBe("render");
    expect(effectiveTrainingProgressMethod("")).toBe("cache");
    expect(effectiveTrainingProgressMethod("?progressMethod=baseline")).toBe("cache");
  });

  it("allows only named methods in the explicit benchmark build", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("MODE", "benchmark");
    const { trainingProgressMethod, trainingProgressExperimentsEnabled, effectiveTrainingProgressMethod } = await import("./training-progress-experiment");
    expect(trainingProgressExperimentsEnabled).toBe(true);
    for (const method of ["baseline", "server", "render", "cache"]) expect(trainingProgressMethod(`?progressMethod=${method}`)).toBe(method);
    expect(trainingProgressMethod("?progressMethod=other")).toBeNull();
    expect(trainingProgressMethod("")).toBeNull();
    expect(effectiveTrainingProgressMethod("")).toBe("cache");
    expect(effectiveTrainingProgressMethod("?progressMethod=baseline")).toBe("baseline");
  });
});
