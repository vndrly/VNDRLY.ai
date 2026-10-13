import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
// Browser previews keep private Fleet data in memory only; devices use encrypted storage.
const memory = new Map<string, string>();
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY;
export const getItemAsync: typeof SecureStore.getItemAsync = async (key, options) => Platform.OS === "web" ? memory.get(key) ?? null : SecureStore.getItemAsync(key, options);
export const setItemAsync: typeof SecureStore.setItemAsync = async (key, value, options) => { if (Platform.OS === "web") memory.set(key, value); else await SecureStore.setItemAsync(key, value, options); };
export const deleteItemAsync: typeof SecureStore.deleteItemAsync = async (key, options) => { if (Platform.OS === "web") memory.delete(key); else await SecureStore.deleteItemAsync(key, options); };
