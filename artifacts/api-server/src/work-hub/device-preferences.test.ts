import { describe, expect, it } from "vitest";
import { learnDevicePreference } from "./device-preferences";

describe("learned Work Hub device preference", () => {
  it("remembers chosen destinations while preserving the saved arrow order", () => {
    let value = { rankedDeviceIds: ["phone"], automaticBackupDeviceIds: [] as string[], learning: {} as Record<string, number> };
    value = learnDevicePreference(value, "desktop");
    value = learnDevicePreference(value, "desktop");
    expect(value.rankedDeviceIds).toEqual(["phone"]);
    value = learnDevicePreference(value, "desktop");
    expect(value.rankedDeviceIds).toEqual(["phone"]);
    expect(value.learning).toEqual({ desktop: 3 });
  });
});
