import { apiFetch } from "./api";
import { captureAuthScope, getUser, isAuthScopeCurrent, type AuthScope } from "./auth";
import { adoptAccountDeviceId, getDeviceId } from "./deviceId";
import { workHubDeviceClass, workHubDeviceLabel } from "./work-hub-device-label";

const pending = new Map<number, Promise<string>>();

/** Register the installation for this account without claiming another user's row. */
export function registerAccountWorkDevice(scope: AuthScope = captureAuthScope()): Promise<string> {
  const existing = pending.get(scope.generation);
  if (existing) return existing;
  const operation = register(scope).finally(() => pending.delete(scope.generation));
  pending.set(scope.generation, operation);
  return operation;
}

async function register(scope: AuthScope) {
  const check = () => { if (!isAuthScopeCurrent(scope)) throw new Error("Account changed. Reopen device setup."); };
  const user = await getUser(); check();
  if (!user || user.requiresContextChoice) throw new Error("Sign in before device setup.");
  const previousDeviceId = await getDeviceId(); check();
  const deviceClass = workHubDeviceClass();
  const registration = await apiFetch<{ id: string; userId: number; owner: { type: string; id: number } }>("/api/work-hub/devices/register", {
    method: "POST", headers: { "x-work-hub-source": "ios" },
    body: JSON.stringify({ deviceId: previousDeviceId, separateAccount: true, friendlyName: workHubDeviceLabel(), deviceClass, capabilities: { microphone: true, speaker: true, camera: true, fileSelection: true, pushNotifications: true } }),
  }, scope); check();
  const ownerId = user.vendorId ?? user.partnerId;
  const ownerType = user.vendorId ? "vendor" : "partner";
  if (registration.userId !== user.id || registration.owner?.id !== ownerId || registration.owner.type !== ownerType) throw new Error("Device registration belongs to a different account.");
  if (registration.id !== previousDeviceId) {
    const consent = await apiFetch<{ inherited: boolean }>(`/api/work-hub/devices/${encodeURIComponent(registration.id)}/inherit-consent`, { method: "POST", body: JSON.stringify({ previousDeviceId }) }, scope); check();
    if (consent.inherited && user.vendorId && deviceClass === "phone") {
      const status = await apiFetch<{ designatedDeviceId: string | null }>("/api/native-operations/status", {}, scope); check();
      if (status.designatedDeviceId === previousDeviceId) {
        await apiFetch("/api/native-operations/device", { method: "PUT", body: JSON.stringify({ deviceId: registration.id, expectedDeviceId: previousDeviceId }) }, scope); check();
      }
    }
    await adoptAccountDeviceId(registration.id, user.id, user.activeMembershipId ?? 0); check();
    await import("./push").then(module => module.rebindRegisteredPushToken()).catch(() => undefined); check();
  }
  return registration.id;
}
