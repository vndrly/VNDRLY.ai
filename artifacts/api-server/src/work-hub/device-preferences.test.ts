import { describe, expect, it } from "vitest";
import { learnDevicePreference } from "./device-preferences";

describe("learned Work Hub device preference", () => {
  it("promotes a repeatedly chosen destination without silently authorizing automatic failover", () => {
    let value = { rankedDeviceIds: ["phone"], automaticBackupDeviceIds: [] as string[], learning: {} as Record<string, number> };
    value = learnDevicePreference(value, "desktop");
    value = learnDevicePreference(value, "desktop");
    expect(value.rankedDeviceIds).toEqual(["phone"]);
    value = learnDevicePreference(value, "desktop");
    expect(value.rankedDeviceIds).toEqual(["desktop", "phone"]);
    expect(value.automaticBackupDeviceIds).toEqual([]);
  });
});
