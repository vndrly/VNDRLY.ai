import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiFetch } from "./api";
import { captureAuthScope, getUser, isAuthScopeCurrent, subscribeToken, subscribeUser } from "./auth";
import { getDeviceId } from "./deviceId";
import { hasActiveConsentForThisDevice } from "./locationConsent";
import { nativeLocationLocallyAllowed } from "./native-operations";
import { isExpoGo } from "./runtime";

export const DUTY_LOCATION_TASK = "vndrly-work-duty-location";
const KEY = "vndrly.work-duty-location";
type Binding = { userId: number; membershipId: number; companyId: number; deviceId: string };
type Authority = Binding & { active: boolean; canReport: boolean };
let generation = 0;
let serial: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const task = serial.then(work, work); serial = task.catch(() => undefined); return task;
}
async function stopOS() {
  if (!isExpoGo && Platform.OS !== "web" && await Location.hasStartedLocationUpdatesAsync(DUTY_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(DUTY_LOCATION_TASK);
}
export function stopDutyBackgroundLocation() {
  generation++;
  return exclusive(async () => { try { await stopOS(); } finally { if (Platform.OS !== "web") await SecureStore.deleteItemAsync(KEY); } });
}
async function authority() {
  const user = await getUser(), scope = captureAuthScope(), deviceId = await getDeviceId();
  if (!user?.vendorId || !user.activeMembershipId || user.requiresContextChoice || !await nativeLocationLocallyAllowed() || !await hasActiveConsentForThisDevice()) return null;
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== "granted") return null;
  const status = await apiFetch<Authority>(`/api/gate-change-over/work-location/status?deviceId=${encodeURIComponent(deviceId)}`, {}, scope);
  if (!isAuthScopeCurrent(scope) || !status.canReport || status.userId !== user.id || status.companyId !== user.vendorId || status.membershipId !== user.activeMembershipId) return null;
  return { scope, binding: { userId: user.id, membershipId: user.activeMembershipId, companyId: user.vendorId, deviceId } };
}
/** Start only with existing consent and permission; OS permission prompts remain user initiated. */
export function synchronizeDutyBackgroundLocation() {
  const request = generation;
  return exclusive(async () => {
    if (isExpoGo || Platform.OS === "web") return;
    const current = await authority();
    if (!current || (await Location.getBackgroundPermissionsAsync()).status !== "granted" || request !== generation) { await stopOS(); await SecureStore.deleteItemAsync(KEY); return; }
    const saved = await SecureStore.getItemAsync(KEY);
    const raw = JSON.stringify(current.binding);
    if (saved !== raw) { await stopOS(); await SecureStore.setItemAsync(KEY, raw, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }); }
    if (request !== generation || !isAuthScopeCurrent(current.scope)) { await stopOS(); await SecureStore.deleteItemAsync(KEY); return; }
    if (!await Location.hasStartedLocationUpdatesAsync(DUTY_LOCATION_TASK)) await Location.startLocationUpdatesAsync(DUTY_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced, timeInterval: 60_000, distanceInterval: 25,
      deferredUpdatesInterval: 60_000, deferredUpdatesDistance: 25,
      showsBackgroundLocationIndicator: true, pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      foregroundService: { notificationTitle: "VNDRLY duty sharing", notificationBody: "Sharing this work phone during your active duty." },
    });
    if (request !== generation || !isAuthScopeCurrent(current.scope)) { await stopOS(); await SecureStore.deleteItemAsync(KEY); }
  });
}
/** No queue: old or inaccurate callbacks never become fabricated current GPS. */
export function reportDutyBackgroundSample(sample: Location.LocationObject) {
  const request = generation;
  return exclusive(async () => {
    const age = Date.now() - sample.timestamp;
    const { latitude, longitude, accuracy } = sample.coords;
    if (!Number.isFinite(age) || age > 120_000 || age < -30_000 || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) return;
    const saved = await SecureStore.getItemAsync(KEY), current = await authority();
    if (!current || saved !== JSON.stringify(current.binding) || request !== generation || (await Location.getBackgroundPermissionsAsync()).status !== "granted") { await stopOS(); await SecureStore.deleteItemAsync(KEY); return; }
    if (!isAuthScopeCurrent(current.scope) || request !== generation) return;
    await apiFetch("/api/gate-change-over/work-location", { method: "POST", body: JSON.stringify({ deviceId: current.binding.deviceId, location: { latitude, longitude, accuracy, capturedAt: new Date(sample.timestamp).toISOString() } }) }, current.scope);
  });
}
if (!isExpoGo && Platform.OS !== "web" && !TaskManager.isTaskDefined(DUTY_LOCATION_TASK)) TaskManager.defineTask(DUTY_LOCATION_TASK, async ({ data, error }) => {
  if (error) { await stopDutyBackgroundLocation(); return; }
  const sample = (data as { locations?: Location.LocationObject[] } | undefined)?.locations?.at(-1);
  if (sample) await reportDutyBackgroundSample(sample).catch(() => undefined);
});
let observedScope = captureAuthScope();
function authChanged() { if (!isAuthScopeCurrent(observedScope)) { observedScope = captureAuthScope(); void stopDutyBackgroundLocation().catch(() => undefined); } }
subscribeUser(authChanged); subscribeToken(authChanged);
