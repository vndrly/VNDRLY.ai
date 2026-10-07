import * as SecureStore from "expo-secure-store";
import { createFleetOfflineStore, fleetOfflineByteLength, FLEET_OFFLINE_MAX_BYTES } from "./fleet-offline";

// Device-only encrypted chunks keep records out of unencrypted preferences.
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const CHUNK = 400;
const MAX_CHUNKS = Math.ceil(FLEET_OFFLINE_MAX_BYTES / CHUNK);
const REGISTRY = "vndrly.fleet.registry";
const scopeKey = /^vndrly\.fleet\.\d+\.\d+\.\d+$/;
function registryKeys(raw: string | null) {
  const value: unknown = JSON.parse(raw ?? "[]");
  if (!Array.isArray(value) || value.length > 20 || value.some(key => typeof key !== "string" || !scopeKey.test(key))) throw new Error("Fleet cache registry is invalid.");
  return [...new Set(value)] as string[];
}
function metadata(raw: string | null) {
  const value = JSON.parse(raw ?? '{"slot":1,"count":0}') as { slot: 0 | 1; count: number };
  if (![0, 1].includes(value.slot) || !Number.isInteger(value.count) || value.count < 0 || value.count > MAX_CHUNKS) throw new Error("Fleet cache generation is invalid.");
  return value;
}
export const nativeFleetOffline = createFleetOfflineStore({
  async getItem(key) {
    const raw = await SecureStore.getItemAsync(`${key}.meta`, options);
    if (!raw) return null;
    const { slot, count } = metadata(raw);
    if (!Number.isInteger(count) || count < 0 || count > MAX_CHUNKS) throw new Error("Fleet offline storage is invalid.");
    if (slot !== 0 && slot !== 1) throw new Error("Fleet offline storage is invalid.");
    const parts = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(`${key}.${slot}.${index}`, options)));
    if (parts.some(part => part === null)) throw new Error("Fleet offline storage is incomplete.");
    return parts.join("");
  },
  async setItem(key, value) {
    if (fleetOfflineByteLength(value) > FLEET_OFFLINE_MAX_BYTES) throw new Error("Assigned Fleet cache exceeds the 64 KB device limit.");
    if (!scopeKey.test(key)) throw new Error("Fleet cache key is invalid.");
    const keys = registryKeys(await SecureStore.getItemAsync(REGISTRY, options));
    if (!keys.includes(key)) { if (keys.length >= 20) throw new Error("Fleet cache registry is full."); await SecureStore.setItemAsync(REGISTRY, JSON.stringify([...keys, key]), options); }
    const count = Math.ceil(value.length / CHUNK);
    if (count > MAX_CHUNKS) throw new Error("Assigned Fleet cache exceeds the device limit.");
    const previous = metadata(await SecureStore.getItemAsync(`${key}.meta`, options));
    const slot = previous.slot === 0 ? 1 : 0;
    for (let index = 0; index < count; index++) await SecureStore.setItemAsync(`${key}.${slot}.${index}`, value.slice(index * CHUNK, (index + 1) * CHUNK), options);
    // Publish the new complete generation only after every encrypted chunk exists.
    await SecureStore.setItemAsync(`${key}.meta`, JSON.stringify({ slot, count }), options);
    for (let index = 0; index < Math.min(previous.count, MAX_CHUNKS); index++) await SecureStore.deleteItemAsync(`${key}.${previous.slot}.${index}`, options);
  },
  async removeItem(key) {
    for (const slot of [0, 1]) for (let index = 0; index < MAX_CHUNKS; index++) await SecureStore.deleteItemAsync(`${key}.${slot}.${index}`, options);
    await SecureStore.deleteItemAsync(`${key}.meta`, options);
  },
});

export async function clearFleetOfflineOnSignOut() {
  return nativeFleetOffline.exclusive(async () => {
  const keys = registryKeys(await SecureStore.getItemAsync(REGISTRY, options));
  for (const key of keys) {
    if (!scopeKey.test(key)) continue;
    for (const slot of [0, 1]) for (let index = 0; index < MAX_CHUNKS; index++) await SecureStore.deleteItemAsync(`${key}.${slot}.${index}`, options);
    await SecureStore.deleteItemAsync(`${key}.meta`, options);
  }
  await SecureStore.deleteItemAsync(REGISTRY, options);
  });
}
