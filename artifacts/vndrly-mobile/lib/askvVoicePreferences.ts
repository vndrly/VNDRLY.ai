import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const STORAGE_PREFIX = "askv:text-only";
const MUTE_PREFIX = "askv:muted";
const ACROSS_PREFIX = "askv:across";
const memoryStore: Record<string, string> = {};

export function askvTextOnlyKey(userId: number): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return globalThis.localStorage?.getItem(key) ?? memoryStore[key] ?? null; }
    catch { return memoryStore[key] ?? null; }
  }
  return SecureStore.getItemAsync(key.replace(/:/g, "."));
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* Memory fallback for restricted storage. */ }
    memoryStore[key] = value;
    return;
  }
  await SecureStore.setItemAsync(key.replace(/:/g, "."), value);
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try { globalThis.localStorage?.removeItem(key); } catch { /* Memory fallback for restricted storage. */ }
    delete memoryStore[key];
    return;
  }
  await SecureStore.deleteItemAsync(key.replace(/:/g, "."));
}

export async function readAskVTextOnly(userId: number): Promise<boolean> {
  return (await getItem(askvTextOnlyKey(userId))) === "1";
}

export async function writeAskVTextOnly(userId: number, enabled: boolean): Promise<void> {
  if (enabled) await setItem(askvTextOnlyKey(userId), "1");
  else await removeItem(askvTextOnlyKey(userId));
}

async function readFlag(prefix: string, userId: number): Promise<boolean> {
  return (await getItem(`${prefix}:${userId}`)) === "1";
}

async function writeFlag(prefix: string, userId: number, enabled: boolean): Promise<void> {
  const key = `${prefix}:${userId}`;
  if (enabled) await setItem(key, "1");
  else await removeItem(key);
}

export async function readAskVMuted(userId: number): Promise<boolean> {
  return readFlag(MUTE_PREFIX, userId);
}

export async function writeAskVMuted(userId: number, enabled: boolean): Promise<void> {
  return writeFlag(MUTE_PREFIX, userId, enabled);
}

export async function readAskVAcrossVndrly(userId: number): Promise<boolean> {
  return readFlag(ACROSS_PREFIX, userId);
}

export async function writeAskVAcrossVndrly(userId: number, enabled: boolean): Promise<void> {
  return writeFlag(ACROSS_PREFIX, userId, enabled);
}
