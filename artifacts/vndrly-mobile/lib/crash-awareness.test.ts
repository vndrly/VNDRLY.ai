import { describe, expect, it, vi } from "vitest";
import {
  evaluatePossibleCrashFallback,
  openSystemEmergencyAction,
  resolveCrashCapability,
} from "./crash-awareness";

describe("crash awareness", () => {
  it("stays manual-only without the Apple entitlement", () => {
    expect(resolveCrashCapability({ platform: "ios", entitlement: false, supported: true, permission: true })).toEqual({ mode: "manual_only" });
  });

  it("uses SafetyKit only when entitlement, support, and permission are all present", () => {
    expect(resolveCrashCapability({ platform: "ios", entitlement: true, supported: true, permission: true })).toEqual({ mode: "safetykit" });
  });

  it("labels a corroborated fallback signal as possible, never confirmed", () => {
    expect(evaluatePossibleCrashFallback({
      activeAuthorizedTrip: true,
      priorSpeedMph: 62,
      currentSpeedMph: 0,
      peakAccelerationG: 3.1,
      locationAccuracyMeters: 12,
      stoppedDurationSeconds: 12,
    })).toEqual({ kind: "possible_crash", confidence: "high" });
    expect(evaluatePossibleCrashFallback({
      activeAuthorizedTrip: false,
      priorSpeedMph: 62,
      currentSpeedMph: 0,
      peakAccelerationG: 3.1,
      locationAccuracyMeters: 12,
      stoppedDurationSeconds: 12,
    })).toBeNull();
  });

  it("opens the system emergency action only after explicit confirmation", async () => {
    const opener = vi.fn(async () => undefined);
    await expect(openSystemEmergencyAction({ confirmed: false, opener })).rejects.toThrow("confirmation");
    await openSystemEmergencyAction({ confirmed: true, opener });
    expect(opener).toHaveBeenCalledTimes(1);
  });
});
