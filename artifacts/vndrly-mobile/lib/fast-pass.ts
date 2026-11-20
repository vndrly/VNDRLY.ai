import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import type { FastPassTripState } from "@workspace/api-zod";
import { apiFetch } from "./api";
import { captureAuthScope, getToken, getUser, isAuthScopeCurrent, subscribeToken, subscribeUser } from "./auth";
import { getDeviceId } from "./deviceId";
import { hasActiveConsentForThisDevice } from "./locationConsent";
import { isExpoGo } from "./runtime";

type Coordinates = { latitude: number; longitude: number };
export type FastPassTrip = {
  id: string;
  driverUserId: number;
  version: number;
  presenceState: "en_route" | "on_site" | "off_site";
  trackingState: "active" | "paused" | "completed";
  lastReliablePoint: (Coordinates & { recordedAt: string }) | null;
  fastPass: FastPassTripState | null;
};

export const fastPassApi = "/api/implementation-a/fast-pass";
export const tripsApi = "/api/implementation-a/trips";
const task = "vndrly-fast-pass-location";
const storageKey = "vndrly.fast-pass.location";
const canRunInBackground = Platform.OS !== "web" && !isExpoGo;
const options = {
  accuracy: Location.Accuracy.High,
  timeInterval: 10_000,
  distanceInterval: 10,
};
type Binding = { tripId: string; userId: number; membershipId: number | null };
let revision = 0;
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
}

export function stopFastPassBackground() {
  revision++;
  return serialize(async () => {
    if (!canRunInBackground) return;
    try {
      if (await Location.hasStartedLocationUpdatesAsync(task)) await Location.stopLocationUpdatesAsync(task);
    } finally {
      await SecureStore.deleteItemAsync(storageKey);
    }
  });
}

export function startFastPassBackground(trip: FastPassTrip) {
  const request = revision;
  const scope = captureAuthScope();
  return serialize(async () => {
    if (!canRunInBackground || !await TaskManager.isAvailableAsync() ||
        (await Location.getBackgroundPermissionsAsync()).status !== "granted") return false;
    const user = await getUser();
    if (!user || user.id !== trip.driverUserId || !await hasActiveConsentForThisDevice() ||
        !isAuthScopeCurrent(scope) || request !== revision) return false;
    const binding: Binding = { tripId: trip.id, userId: user.id, membershipId: user.activeMembershipId ?? null };
    await SecureStore.setItemAsync(storageKey, JSON.stringify(binding), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    if (!await Location.hasStartedLocationUpdatesAsync(task)) {
      await Location.startLocationUpdatesAsync(task, {
        ...options,
        activityType: Location.ActivityType.AutomotiveNavigation,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: { notificationTitle: "VNDRLY Fast Pass", notificationBody: "Sharing location for your active trip." },
      });
    }
    return true;
  });
}

export async function readFastPassTrip() {
  return apiFetch<FastPassTrip | null>(tripsApi + "/active");
}

export async function reportFastPassPoint(tripId: string, sample: Location.LocationObject, scope = captureAuthScope()) {
  const { accuracy, latitude, longitude, speed } = sample.coords;
  const age = Date.now() - sample.timestamp;
  if (!Number.isFinite(age) || age > 120_000 || age < -30_000 || !isAuthScopeCurrent(scope) ||
      accuracy == null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100 ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  const current = await apiFetch<FastPassTrip | null>(tripsApi + "/active", {}, scope);
  if (!current?.fastPass || current.id !== tripId || current.trackingState !== "active") return null;
  if (current.lastReliablePoint && Date.parse(current.lastReliablePoint.recordedAt) >= sample.timestamp) return current;
  const location = { latitude, longitude, accuracyMeters: accuracy, speedMps: speed == null || speed < 0 ? null : speed, recordedAt: new Date(sample.timestamp).toISOString() };
  await apiFetch(tripsApi + "/" + tripId + "/location", {
    method: "POST",
    headers: { "x-vndrly-device-id": await getDeviceId() },
    body: JSON.stringify({ ...location, expectedVersion: current.version }),
  }, scope);
  return apiFetch<FastPassTrip | null>(tripsApi + "/active", {}, scope);
}

export function watchFastPassLocation(listener: (sample: Location.LocationObject) => void) {
  return Location.watchPositionAsync(options, listener);
}

if (canRunInBackground && !TaskManager.isTaskDefined(task)) {
  TaskManager.defineTask(task, async ({ data, error }) => {
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
    if (error) return stopFastPassBackground();
    if (!locations?.length) return;
    const request = revision;
    const keepTracking = await serialize(async () => {
      const raw = await SecureStore.getItemAsync(storageKey);
      if (!raw || request !== revision) return false;
      const saved: Binding = JSON.parse(raw);
      const user = await getUser();
      await getToken();
      const scope = captureAuthScope();
      if (user?.id !== saved.userId || (user.activeMembershipId ?? null) !== saved.membershipId ||
          !await hasActiveConsentForThisDevice() || request !== revision || !isAuthScopeCurrent(scope)) return false;
      for (const point of locations) {
        if (request !== revision || !isAuthScopeCurrent(scope)) return false;
        if (await reportFastPassPoint(saved.tripId, point, scope) === null) return false;
      }
      return true;
    }).catch((failure: { status?: number }) => ![401, 403, 404].includes(failure.status ?? 0));
    if (!keepTracking && request === revision) await stopFastPassBackground();
  });
  let scope = captureAuthScope();
  function stopOnAccountChange() {
    if (isAuthScopeCurrent(scope)) return;
    scope = captureAuthScope();
    void stopFastPassBackground().catch(() => undefined);
  }
  subscribeUser(stopOnAccountChange);
  subscribeToken(stopOnAccountChange);
}
