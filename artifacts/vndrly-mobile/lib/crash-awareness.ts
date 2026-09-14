import { Linking, Platform } from "react-native";

export type CrashAwarenessCapability = { mode: "manual_only" | "safetykit" };

export function resolveCrashCapability(input: {
  platform: string;
  entitlement: boolean;
  supported: boolean;
  permission: boolean;
}): CrashAwarenessCapability {
  return input.platform === "ios" && input.entitlement && input.supported && input.permission
    ? { mode: "safetykit" }
    : { mode: "manual_only" };
}

export function evaluatePossibleCrashFallback(input: {
  activeAuthorizedTrip: boolean;
  priorSpeedMph: number;
  currentSpeedMph: number;
  peakAccelerationG: number;
  locationAccuracyMeters: number;
  stoppedDurationSeconds: number;
}): { kind: "possible_crash"; confidence: "high" | "medium" } | null {
  if (!input.activeAuthorizedTrip || input.locationAccuracyMeters > 50) return null;
  const sharpStop = input.priorSpeedMph >= 35 && input.currentSpeedMph <= 5;
  const impact = input.peakAccelerationG >= 2.5;
  const remainedStopped = input.stoppedDurationSeconds >= 8;
  if (sharpStop && impact && remainedStopped) return { kind: "possible_crash", confidence: "high" };
  if (sharpStop && impact && input.stoppedDurationSeconds >= 4) return { kind: "possible_crash", confidence: "medium" };
  return null;
}

export async function openSystemEmergencyAction(input: {
  confirmed: boolean;
  opener?: () => Promise<void>;
}): Promise<void> {
  if (!input.confirmed) throw new Error("Explicit confirmation is required before opening emergency calling");
  if (input.opener) return input.opener();
  if (Platform.OS !== "web") await Linking.openURL("tel:911");
}

export async function subscribeToSevereCrashEvents(
  listener: (event: { occurredAt: string; source: "apple" }) => void,
): Promise<() => void> {
  const module = await import("../modules/vndrly-safetykit/src/VndrlySafetyKitModule").then((value) => value.default).catch(() => null);
  if (!module) return () => undefined;
  const capability = resolveCrashCapability({ platform: Platform.OS, ...(await module.getCapability()) });
  if (capability.mode !== "safetykit" || !(await module.startMonitoring())) return () => undefined;
  const subscription = module.addListener("onSevereCrash", listener);
  return () => { subscription.remove(); void module.stopMonitoring(); };
}
