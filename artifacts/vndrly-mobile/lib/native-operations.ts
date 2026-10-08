import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { apiFetch } from "./api";
import { captureAuthScope, getUser, isAuthScopeCurrent, type AuthScope } from "./auth";
import { getDeviceId } from "./deviceId";
import { maySupplyFreshLocation, requestIsActionable, type NativeDeviceRequest, type NativeOperationsStatus } from "./native-operations-policy";
const base = "/api/native-operations";
// End Duty / revoke consent blocks in-flight responses locally before network acknowledgment.
const suppressed = new Set<number>();
const locationRequests = new Set<string>();
async function suppressionKey() {
  const user = await getUser();
  return user ? `vndrly.duty-stop.${user.id}.${user.activeMembershipId ?? 0}` : null;
}
async function locallyStopped() { const key = await suppressionKey(); return key ? await SecureStore.getItemAsync(key) === "true" || await SecureStore.getItemAsync(`${key}.consent`) === "true" : true; }
export async function nativeLocationCollectionAllowed() {
  const scope = captureAuthScope();
  if (suppressed.has(scope.generation) || await locallyStopped()) return false;
  try { const status = await readNativeOperations(scope); return isAuthScopeCurrent(scope) && status.duty?.active === true && maySupplyFreshLocation(status, await getDeviceId()); }
  catch { return false; }
}
export function readNativeOperations(scope = captureAuthScope()) {
  return apiFetch<NativeOperationsStatus>(`${base}/status`, {}, scope);
}
export async function updateNativeConsent(locationSharing: boolean, automaticArrival?: boolean) {
  const scope = captureAuthScope();
  if (!locationSharing) {
    suppressed.add(scope.generation);
    const key = await suppressionKey();
    if (key) await SecureStore.setItemAsync(`${key}.consent`, "true", { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  }
  const result = await apiFetch(`${base}/consent`, { method: "PUT", body: JSON.stringify({ locationSharing, ...(automaticArrival === undefined ? {} : { automaticArrival }) }) }, scope);
  if (locationSharing && isAuthScopeCurrent(scope)) {
    const key = await suppressionKey(); if (key) await SecureStore.deleteItemAsync(`${key}.consent`);
    if (!await locallyStopped()) suppressed.delete(scope.generation);
  }
  return result;
}
export async function designateNativeWorkPhone() {
  const result = await apiFetch(`${base}/device`, { method: "PUT", body: JSON.stringify({ deviceId: await getDeviceId() }) });
  await import("./push").then(module => module.rebindRegisteredPushToken()).catch(() => undefined);
  return result;
}
export async function changeNativeDuty(action: "start" | "end", options: { mode: "manual" | "ticket" | "scheduled"; ticketId?: number; shiftId?: string } = { mode: "manual" }) {
  const scope = captureAuthScope();
  if (action === "end") suppressed.add(scope.generation);
  if (action === "end") {
    void import("./liveLocationReporter").then(module => module.stopLiveLocationReporter()).catch(() => undefined);
    void import("./fleet-background-location-native").then(module => module.stopFleetBackgroundLocation(false)).catch(() => undefined);
  }
  const key = await suppressionKey();
  if (action === "end" && key) await SecureStore.setItemAsync(key, "true", { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  const result = await apiFetch(`${base}/duty`, { method: "POST", body: JSON.stringify({ action, ...options }) }, scope);
  if (action === "start" && isAuthScopeCurrent(scope)) { if (key) await SecureStore.deleteItemAsync(key); if (!await locallyStopped()) suppressed.delete(scope.generation); }
  return result;
}
export async function respondNativeRequest(id: string, body: Record<string, unknown>, scope = captureAuthScope(), startedBinding?: { deviceId: string; bindingVersion: number }) {
  const status = await readNativeOperations(scope);
  const deviceId = await getDeviceId();
  return apiFetch<NativeDeviceRequest>(`${base}/requests/${encodeURIComponent(id)}/respond`, {
    method: "POST", body: JSON.stringify({ ...body, deviceId: startedBinding?.deviceId ?? deviceId, bindingVersion: startedBinding?.bindingVersion ?? status.bindingVersion }),
  }, scope);
}
export function readNativeRequest(id: string, scope = captureAuthScope()) {
  return apiFetch<NativeDeviceRequest>(`${base}/requests/${encodeURIComponent(id)}`, {}, scope);
}
export function selectNativePrimaryTask(kind: "ticket" | "gate" | "fleet", id: string) {
  return apiFetch<NativeOperationsStatus>(`${base}/task`, { method: "PUT", body: JSON.stringify({ kind, id }) });
}
/** Foreground polling cannot promise iOS background wake. Never prompts for GPS remotely. */
export async function answerForegroundLocation(request: NativeDeviceRequest, scope: AuthScope) {
  if (locationRequests.has(request.id)) return;
  locationRequests.add(request.id);
  try { await collectFreshLocation(request, scope); } finally { locationRequests.delete(request.id); }
}
async function collectFreshLocation(request: NativeDeviceRequest, scope: AuthScope) {
  const status = await readNativeOperations(scope);
  const deviceId = await getDeviceId();
  const user = await getUser();
  if (!user || request.workerUserId !== user.id || request.deviceId !== deviceId || request.bindingVersion !== status.bindingVersion) return;
  if (!isAuthScopeCurrent(scope) || suppressed.has(scope.generation) || await locallyStopped() || !requestIsActionable(request)) return;
  if (status.designatedDeviceId !== deviceId) return; // viewers must not fail the work phone's request
  const permission = await Location.getForegroundPermissionsAsync();
  const backgroundAllowed = AppState.currentState === "active" || (await Location.getBackgroundPermissionsAsync()).status === "granted";
  if (!maySupplyFreshLocation(status, deviceId) || permission.status !== "granted" || !backgroundAllowed) {
    await respondNativeRequest(request.id, { state: "unavailable", note: "Duty, consent or location permission unavailable" }, scope);
    return;
  }
  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("fresh_location_timeout")), 20_000); }),
    ]).finally(() => { if (timeout) clearTimeout(timeout); });
    if (!isAuthScopeCurrent(scope)) return;
    const fresh = await readNativeOperations(scope);
    if (suppressed.has(scope.generation) || await locallyStopped() || !maySupplyFreshLocation(fresh, deviceId) || !requestIsActionable(request)) return;
    await respondNativeRequest(request.id, { state: "saved", location: {
      latitude: position.coords.latitude, longitude: position.coords.longitude,
      accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString(),
    } }, scope);
  } catch {
    if (isAuthScopeCurrent(scope)) await respondNativeRequest(request.id, { state: "unavailable", note: "Fresh location could not be obtained" }, scope);
  }
}
