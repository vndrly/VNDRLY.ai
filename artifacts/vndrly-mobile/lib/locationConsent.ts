import * as SecureStore from "expo-secure-store";

import { apiFetch } from "./api";
import { getDeviceId } from "./deviceId";

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
  return (await safeGet(DECLINED_KEY)) === "1";
}

export async function setConsentDeclined(declined: boolean): Promise<void> {
  if (declined) await safeSet(DECLINED_KEY, "1");
  else await safeDel(DECLINED_KEY);
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

export async function hasActiveConsentForThisDevice(): Promise<boolean> {
  const deviceId = await getDeviceId();
  const consents = await getMyConsents();
  return consents.some((c) => c.deviceId === deviceId && !c.revokedAt);
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
