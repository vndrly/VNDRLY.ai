import * as SecureStore from "expo-secure-store";
import { captureAuthScope, getUser, isAuthScopeCurrent } from "./auth";

const KEY = "vndrly.deviceId";
let cached: string | null = null;

function genId(): string {
  // Lightweight UUID v4-ish generator (sufficient for an opaque per-install id).
  const rand = (n: number) => Math.floor(Math.random() * n);
  const hex = (n: number, l: number) => n.toString(16).padStart(l, "0");
  return [
    hex(rand(0xffffffff), 8),
    hex(rand(0xffff), 4),
    hex((rand(0x0fff) | 0x4000), 4),
    hex((rand(0x3fff) | 0x8000), 4),
    hex(rand(0xffffffff), 8) + hex(rand(0xffff), 4),
  ].join("-");
}

async function getStore(key: string): Promise<string | null> {
  if (typeof window !== "undefined" && (window as any).localStorage) {
    return (window as any).localStorage.getItem(key);
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setStore(key: string, value: string): Promise<void> {
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

async function installationDeviceId(): Promise<string> {
  if (cached) return cached;
  let id = await getStore(KEY);
  if (!id) {
    id = genId();
    await setStore(KEY, id);
  }
  cached = id;
  return id;
}

export async function getDeviceId(): Promise<string> {
  const scope = captureAuthScope(), user = await getUser();
  const key = user ? `${KEY}.${user.id}.${user.activeMembershipId ?? 0}` : null;
  const id = (key ? await getStore(key) : null) ?? await installationDeviceId();
  if (!isAuthScopeCurrent(scope)) throw new Error("Account changed. Reopen device setup.");
  return id;
}

/** Only adopt the server-returned owned registration in the initiating account. */
export async function adoptAccountDeviceId(id: string, userId: number, membershipId: number) {
  const scope = captureAuthScope(), user = await getUser();
  if (!user || user.id !== userId || (user.activeMembershipId ?? 0) !== membershipId || !isAuthScopeCurrent(scope)) throw new Error("Account changed. Reopen device setup.");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error("Invalid device registration.");
  const key = `${KEY}.${userId}.${membershipId}`;
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.setItem(key, id);
  else await SecureStore.setItemAsync(key, id);
  if (!isAuthScopeCurrent(scope)) throw new Error("Account changed. Reopen device setup.");
}
