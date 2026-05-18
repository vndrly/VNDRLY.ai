import * as SecureStore from "expo-secure-store";

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

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  let id = await getStore(KEY);
  if (!id) {
    id = genId();
    await setStore(KEY, id);
  }
  cached = id;
  return id;
}
