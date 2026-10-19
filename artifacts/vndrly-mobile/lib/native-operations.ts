import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import { apiFetch } from "./api";
import { captureAuthScope, getUser, isAuthScopeCurrent, type AuthScope } from "./auth";
import { getDeviceId } from "./deviceId";
import { maySupplyFreshLocation, requestIsActionable, type NativeDeviceRequest, type NativeOperationsStatus } from "./native-operations-policy";
const base = "/api/native-operations";
const stopStore = {
 getItemAsync: async (key: string) => Platform.OS === "web" ? window.localStorage.getItem(key) : SecureStore.getItemAsync(key),
 setItemAsync: async (key: string, value: string, options?: SecureStore.SecureStoreOptions) => { if (Platform.OS === "web") window.localStorage.setItem(key,value); else await SecureStore.setItemAsync(key,value,options); },
 deleteItemAsync: async (key: string) => { if (Platform.OS === "web") window.localStorage.removeItem(key); else await SecureStore.deleteItemAsync(key); },
};
// End Duty / revoke consent blocks in-flight responses locally before network acknowledgment.
const suppressed = new Set<number>();
const locationRequests = new Set<string>();
async function suppressionKey() {
  const user = await getUser();
  return user ? `vndrly.duty-stop.${user.id}.${user.activeMembershipId ?? 0}` : null;
}
async function locallyStopped() { const key = await suppressionKey(); return key ? await stopStore.getItemAsync(key) === "true" || await stopStore.getItemAsync(`${key}.consent`) === "true" : true; }
export async function nativeLocationLocallyAllowed() { return !suppressed.has(captureAuthScope().generation) && !await locallyStopped(); }
export async function nativeLocationCollectionAllowed() {
  const scope = captureAuthScope();
  if (suppressed.has(scope.generation) || await locallyStopped()) return false;
  try { const status = await readNativeOperations(scope); return isAuthScopeCurrent(scope) && maySupplyFreshLocation(status, await getDeviceId()); }
  catch { return false; }
}
export async function readNativeOperations(scope = captureAuthScope()) {
  const status=await apiFetch<NativeOperationsStatus>(`${base}/status`, {}, scope);
  if(isAuthScopeCurrent(scope)){const key=await suppressionKey();if(key)await stopStore.setItemAsync(`${key}.verified-status`,JSON.stringify(status),{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY});}
  return status;
}
async function verifiedOnCallContinues(){
 const key=await suppressionKey();if(!key||await stopStore.getItemAsync(`${key}.oncall-stop`)==="true")return false;
 try{const value=JSON.parse(await stopStore.getItemAsync(`${key}.verified-status`)??"null") as NativeOperationsStatus|null;
  return !!value&&maySupplyFreshLocation({...value,duty:{active:false}},await getDeviceId());
 }catch{return false;}
}
export async function updateNativeConsent(locationSharing: boolean, automaticArrival?: boolean) {
  const scope = captureAuthScope();
  if (!locationSharing) {
    suppressed.add(scope.generation);
    void import("./duty-background-location").then(module => module.stopDutyBackgroundLocation()).catch(() => undefined);
    const key = await suppressionKey();
    if (key) await stopStore.setItemAsync(`${key}.consent`, "true", { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  }
  const result = await apiFetch(`${base}/consent`, { method: "PUT", body: JSON.stringify({ locationSharing, ...(automaticArrival === undefined ? {} : { automaticArrival }) }) }, scope);
  if (locationSharing && isAuthScopeCurrent(scope)) {
    const key = await suppressionKey(); if (key) await stopStore.deleteItemAsync(`${key}.consent`);
    if (!await locallyStopped()) suppressed.delete(scope.generation);
  }
  return result;
}
export async function designateNativeWorkPhone() {
  const scope = captureAuthScope();
  const { registerAccountWorkDevice } = await import("./account-device-registration");
  const deviceId = await registerAccountWorkDevice(scope);
  if (!isAuthScopeCurrent(scope)) throw new Error("Account changed. Reopen device setup.");
  const result = await apiFetch(`${base}/device`, { method: "PUT", body: JSON.stringify({ deviceId }) }, scope);
  await import("./push").then(module => module.rebindRegisteredPushToken()).catch(() => undefined);
  return result;
}
export async function changeNativeDuty(action: "start" | "end", options: { mode: "manual" | "ticket" | "scheduled"; ticketId?: number; shiftId?: string } = { mode: "manual" }) {
  const scope = captureAuthScope();
  const stop=action==="end"&&!await verifiedOnCallContinues();
  if (stop) suppressed.add(scope.generation);
  if (stop) {
    void import("./duty-background-location").then(module => module.stopDutyBackgroundLocation()).catch(() => undefined);
    void import("./liveLocationReporter").then(module => module.stopLiveLocationReporter()).catch(() => undefined);
    void import("./fleet-background-location-native").then(module => module.stopFleetBackgroundLocation(false)).catch(() => undefined);
  }
  const key = await suppressionKey();
  if (stop && key) await stopStore.setItemAsync(key, "true", { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  const result = await apiFetch<NativeOperationsStatus>(`${base}/duty`, { method: "POST", body: JSON.stringify({ action, ...options }) }, scope);
  if ((action === "start" || result.onCallActive === true) && isAuthScopeCurrent(scope)) { if (key) await stopStore.deleteItemAsync(key); if (!await locallyStopped()) suppressed.delete(scope.generation); }
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

export async function changeNativeOnCall(active: boolean, shiftActive = false) {
 const scope = captureAuthScope();
 const onCallKey=await suppressionKey();if(!active&&onCallKey)await stopStore.setItemAsync(`${onCallKey}.oncall-stop`,"true");
 if (!active && !shiftActive) { suppressed.add(scope.generation); const key = await suppressionKey(); if(key) await stopStore.setItemAsync(key,"true"); await stopNativeBackgroundCollection(); }
 const result = await apiFetch<NativeOperationsStatus>(base + "/on-call", {method:"PUT",body:JSON.stringify({active,consent:true})}, scope);
 if (!isAuthScopeCurrent(scope)) return result;
 const key = await suppressionKey();
 if(active&&key){await stopStore.deleteItemAsync(`${key}.oncall-stop`);await stopStore.setItemAsync(`${key}.verified-status`,JSON.stringify(result),{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY});}
 if (active || result.duty?.active) { if(key) await stopStore.deleteItemAsync(key); if (!await locallyStopped()) suppressed.delete(scope.generation); }
 else { suppressed.add(scope.generation); if(key) await stopStore.setItemAsync(key,"true"); await stopNativeBackgroundCollection(); }
 return result;
}
async function stopNativeBackgroundCollection() {
 await import("./liveLocationReporter").then(module => module.stopLiveLocationReporter());
 await import("./fleet-background-location-native").then(module => module.stopFleetBackgroundLocation(false));
}
