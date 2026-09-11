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
  requiresContextChoice?: boolean;
};

const userListeners = new Set<(user: StoredUser | null) => void>();
let authGeneration = 0;
let cachedUser: StoredUser | null = null;
let cachedUserLoaded = false;

export type AuthScope = Readonly<{ generation: number }>;

export function captureAuthScope(): AuthScope {
  return Object.freeze({ generation: authGeneration });
}

export function isAuthScopeCurrent(scope: AuthScope): boolean {
  return scope.generation === authGeneration;
}

export function subscribeUser(listener: (user: StoredUser | null) => void): () => void {
  userListeners.add(listener);
  return () => {
    userListeners.delete(listener);
  };
}

function notifyUser(user: StoredUser | null) {
  cachedUser = user;
  cachedUserLoaded = true;
  cachedRole = user?.role ?? null;
  authGeneration += 1;
  userListeners.forEach((l) => l(user));
}

const memoryStore: Record<string, string> = {};

let cachedToken: string | null = null;
let cachedTokenLoaded = false;
let cachedRole: string | null = null;
let tokenStorageQueue = Promise.resolve();
let userStorageQueue = Promise.resolve();
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

function notifyToken(token: string | null, invalidateScopes = true) {
  cachedToken = token;
  cachedTokenLoaded = true;
  if (invalidateScopes) authGeneration += 1;
  tokenListeners.forEach((l) => l(token));
}

function queueTokenStorage(work: () => Promise<void>): Promise<void> {
  const pending = tokenStorageQueue.then(work);
  tokenStorageQueue = pending.catch(() => undefined);
  return pending;
}

function queueUserStorage(work: () => Promise<void>): Promise<void> {
  const pending = userStorageQueue.then(work);
  userStorageQueue = pending.catch(() => undefined);
  return pending;
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
  const generation = authGeneration;
  const t = await getItem(TOKEN_KEY);
  if (generation !== authGeneration) return cachedToken;
  // Hydration supplies the credential to the request already waiting for it;
  // it is not an auth mutation and must not obsolete that request's scope.
  notifyToken(t, false);
  return t;
}

export function setToken(token: string | null): Promise<void> {
  notifyToken(token);
  return queueTokenStorage(() => token
    ? setItem(TOKEN_KEY, token)
    : removeItem(TOKEN_KEY));
}

export async function getUser(): Promise<StoredUser | null> {
  if (cachedUserLoaded) return cachedUser;
  const generation = authGeneration;
  const raw = await getItem(USER_KEY);
  if (generation !== authGeneration) return cachedUser;
  cachedUserLoaded = true;
  if (!raw) {
    cachedUser = null;
    cachedRole = null;
    return null;
  }
  try {
    const u = JSON.parse(raw) as StoredUser;
    cachedUser = u;
    cachedRole = u?.role ?? null;
    return u;
  } catch {
    cachedUser = null;
    cachedRole = null;
    return null;
  }
}

export function setUser(user: StoredUser | null): Promise<void> {
  notifyUser(user);
  return queueUserStorage(() => user
    ? setItem(USER_KEY, JSON.stringify(user))
    : removeItem(USER_KEY));
}

export async function clearAuthIfCurrent(scope: AuthScope): Promise<boolean> {
  if (!isAuthScopeCurrent(scope)) return false;
  const tokenWrite = setToken(null);
  const userWrite = setUser(null);
  // The in-memory clear is authoritative and synchronous. Persistence remains
  // best effort so a storage fault cannot replace the server's original 401.
  await Promise.allSettled([tokenWrite, userWrite]);
  return true;
}

export async function clearAuth() {
  await setToken(null);
  await setUser(null);
}
