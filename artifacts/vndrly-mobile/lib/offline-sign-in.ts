import * as Crypto from "expo-crypto";
import type { StoredUser } from "./auth";
import { getNativeWorkHubQueueStore } from "./work-hub-queue-native";

/** The token of a session signed in on this device with no connection. It is never sent to the server. */
export const OFFLINE_TOKEN = "offline";
/** John, 2026-11-28: an offline sign-in stays good for 30 days after the server last confirmed it on this device. */
export const OFFLINE_SIGN_IN_MS = 30 * 24 * 60 * 60_000;
const CURRENT = "offline-sign-in.current";

type Remembered = { salt: string; proof: string; at: number; user: StoredUser };
let held: { username: string; password: string } | null = null;

const sha = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
const name = (username: string) => username.trim().toLowerCase();
const slot = async (username: string) => `offline-sign-in.${await sha(name(username))}`;
const proof = (salt: string, username: string, password: string) => sha([salt, name(username), password].join("\n"));

async function read(key: string): Promise<Remembered | null> {
  const raw = await (await getNativeWorkHubQueueStore()).getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as Remembered; } catch { return null; }
}
async function write(key: string, value: Remembered) {
  const store = await getNativeWorkHubQueueStore();
  await store.setItem(key, JSON.stringify(value));
  await store.setItem(CURRENT, key);
}

/** After a sign-in the server accepted: keeps a salted hash of the password, never the password, in the device's encrypted store. */
export async function rememberSignIn(username: string, password: string, user: StoredUser) {
  if (user.mustChangePassword) return;
  const salt = Crypto.randomUUID();
  await write(await slot(username), { salt, proof: await proof(salt, username, password), at: Date.now(), user });
}

/** The server confirmed this session again, or its profile changed: renew the saved copy. */
export async function confirmSignIn(user: StoredUser) {
  const key = await (await getNativeWorkHubQueueStore()).getItem(CURRENT);
  const saved = key ? await read(key) : null;
  if (key && saved && saved.user.id === user.id) await write(key, { ...saved, at: Date.now(), user });
}

/** No connection: the profile of a sign-in this device has seen the server accept, or null. */
export async function offlineSignIn(username: string, password: string): Promise<StoredUser | null> {
  const key = await slot(username);
  const saved = await read(key);
  if (!saved || Date.now() - saved.at > OFFLINE_SIGN_IN_MS) return null;
  if ((await proof(saved.salt, username, password)) !== saved.proof) return null;
  await (await getNativeWorkHubQueueStore()).setItem(CURRENT, key);
  // Kept in memory only, to sign in with the server as soon as it can be reached.
  held = { username, password };
  return saved.user;
}

export function heldOfflineSignIn() { return held; }
export function forgetOfflinePassword() { held = null; }
