import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TOKEN_KEY = "vndrly.token";
const USER_KEY = "vndrly.user";

export type MembershipSummary = {
  id: number;
  orgType: "partner" | "vendor";
  orgId: number;
  orgName: string;
  orgLogoUrl: string | null;
  role: string;
  vendorPeopleId: number | null;
};

export type StoredUser = {
  id: number;
  username: string;
  role: string;
  displayName: string | null;
  partnerId?: number | null;
  vendorId?: number | null;
  // For field_employee users this exposes the per-vendor role
  // (foreman | field | both) so foreman-only UI can gate correctly.
  vendorRole?: string | null;
  vendorPeopleId?: number | null;
  preferredLanguage?: "en" | "es" | "pt" | null;
  // Mirrors of the web app's auth state so the mobile header can show
  // the active org name + Partner/Vendor pill, and dual-membership users
  // can switch contexts from the profile screen.
  activeMembershipId?: number | null;
  availableMemberships?: MembershipSummary[];
};

const userListeners = new Set<(user: StoredUser | null) => void>();

export function subscribeUser(listener: (user: StoredUser | null) => void): () => void {
  userListeners.add(listener);
  return () => {
    userListeners.delete(listener);
  };
}

function notifyUser(user: StoredUser | null) {
  userListeners.forEach((l) => l(user));
}

const memoryStore: Record<string, string> = {};

let cachedToken: string | null = null;
let cachedTokenLoaded = false;
let cachedRole: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

export function getCachedRole(): string | null {
  return cachedRole;
}

export function getCachedToken(): string | null {
  return cachedToken;
}

export function isTokenCacheReady(): boolean {
  return cachedTokenLoaded;
}

export function subscribeToken(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

function notifyToken(token: string | null) {
  cachedToken = token;
  cachedTokenLoaded = true;
  tokenListeners.forEach((l) => l(token));
}

function webStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    const ls = webStorage();
    return ls ? ls.getItem(key) : (memoryStore[key] ?? null);
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    const ls = webStorage();
    if (ls) ls.setItem(key, value);
    else memoryStore[key] = value;
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    const ls = webStorage();
    if (ls) ls.removeItem(key);
    else delete memoryStore[key];
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getToken(): Promise<string | null> {
  if (cachedTokenLoaded) return cachedToken;
  const t = await getItem(TOKEN_KEY);
  notifyToken(t);
  return t;
}

export async function setToken(token: string | null) {
  if (token) await setItem(TOKEN_KEY, token);
  else await removeItem(TOKEN_KEY);
  notifyToken(token);
}

export async function getUser(): Promise<StoredUser | null> {
  const raw = await getItem(USER_KEY);
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as StoredUser;
    cachedRole = u?.role ?? null;
    return u;
  } catch {
    return null;
  }
}

export async function setUser(user: StoredUser | null) {
  if (user) await setItem(USER_KEY, JSON.stringify(user));
  else await removeItem(USER_KEY);
  cachedRole = user?.role ?? null;
  notifyUser(user);
}

export async function clearAuth() {
  await setToken(null);
  await setUser(null);
}
