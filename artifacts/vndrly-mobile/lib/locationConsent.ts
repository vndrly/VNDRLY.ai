import * as SecureStore from "expo-secure-store";

import { apiFetch } from "./api";
import { getDeviceId } from "./deviceId";
import { getUser } from "./auth";

const DECLINED_KEY = "vndrly.locationConsentDeclined";

async function safeGet(key: string): Promise<string | null> {
  if (typeof window !== "undefined" && (window as any).localStorage) {
    return (window as any).localStorage.getItem(key);
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function safeSet(key: string, value: string): Promise<void> {
  if (typeof window !== "undefined" && (window as any).localStorage) {
    (window as any).localStorage.setItem(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // ignore
  }
}

async function safeDel(key: string): Promise<void> {
  if (typeof window !== "undefined" && (window as any).localStorage) {
    (window as any).localStorage.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export async function isConsentDeclined(): Promise<boolean> {
  const user = await getUser();
  return user ? (await safeGet(`${DECLINED_KEY}.${user.id}.${user.activeMembershipId ?? 0}`)) === "1" : false;
}

export async function setConsentDeclined(declined: boolean): Promise<void> {
  const user = await getUser();
  if (!user) return;
  const key = `${DECLINED_KEY}.${user.id}.${user.activeMembershipId ?? 0}`;
  if (declined) await safeSet(key, "1");
  else await safeDel(key);
}

export type LocationConsent = {
  id: number;
  userId: number;
  deviceId: string;
  acceptedAt: string;
  revokedAt: string | null;
};

export async function getMyConsents(): Promise<LocationConsent[]> {
  try {
    const r = await apiFetch<{ consents: LocationConsent[] }>("/api/location-consents/me");
    return r.consents ?? [];
  } catch {
    return [];
  }
}

export async function getDeviceConsentStatus(): Promise<"accepted" | "not_accepted" | "unavailable"> {
  try {
    const deviceId = await getDeviceId();
    const result = await apiFetch<{consents: LocationConsent[]}>("/api/location-consents/me");
    if (!Array.isArray(result.consents)) return "unavailable";
    return result.consents.some(c => c.deviceId === deviceId && !c.revokedAt) ? "accepted" : "not_accepted";
  } catch { return "unavailable"; }
}

export async function hasActiveConsentForThisDevice(): Promise<boolean> {
  return await getDeviceConsentStatus() === "accepted";
}

export async function acceptConsent(): Promise<void> {
  const deviceId = await getDeviceId();
  await apiFetch("/api/location-consents", {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  });
}

export async function revokeConsent(): Promise<void> {
  const deviceId = await getDeviceId();
  const qs = new URLSearchParams({ deviceId }).toString();
  await apiFetch(`/api/location-consents?${qs}`, { method: "DELETE" });
}
