import { Alert, Platform } from "react-native";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import * as Localization from "expo-localization";

import {
  getToken,
  getUser,
  captureAuthScope,
  clearAuthIfCurrent,
  isAuthScopeCurrent,
  setToken,
  setUser,
  type AuthScope,
  type MembershipSummary,
  type StoredUser,
} from "./auth";
import { setLanguage } from "./i18n";
import {
  OFFLINE_TOKEN,
  confirmSignIn,
  forgetOfflinePassword,
  heldOfflineSignIn,
  offlineSignIn,
  rememberSignIn,
} from "./offline-sign-in";

/**
 * Best-effort read of the device's preferred locale (e.g. "es-MX") so the
 * server can auto-seed `users.preferred_language` on first login (Task
 * #837). We never throw — a missing locale just means no auto-seed signal
 * and the server falls back to its existing default.
 */
function readDeviceLocale(): string | null {
  try {
    const locales = Localization.getLocales();
    for (const loc of locales) {
      const tag = loc.languageTag ?? loc.languageCode;
      if (typeof tag === "string" && tag.trim()) return tag;
    }
  } catch {
    // ignore
  }
  return null;
}

export function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN || "https://vndrly.ai";
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

let _initialized = false;
export function initApi() {
  if (_initialized) return;
  _initialized = true;
  setBaseUrl(getApiBase());
  setAuthTokenGetter(async () => {
    const token = await getToken();
    return token === OFFLINE_TOKEN ? null : token;
  });
}

type ApiRequestError = Error & {
  status?: number;
  data?: unknown;
  code?: string;
  retryAfterMs?: number;
};

export type ScopedRawResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly url: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  json(): Promise<any>;
  text(): Promise<string>;
};

function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1_000;
    return Number.isFinite(delay) ? delay : undefined;
  }
  if (
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value,
    )
  )
    return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toUTCString() === value
    ? Math.max(0, at - now)
    : undefined;
}

async function scopedRequest(
  path: string,
  init: RequestInit,
  authScope: AuthScope | undefined,
  acceptJson: boolean,
) {
  let requestAuthScope = authScope ?? captureAuthScope();
  const abortError = () =>
    Object.assign(new Error("Request authorization changed"), {
      name: "AbortError",
    });
  const assertNotAborted = () => {
    if (init.signal?.aborted) throw abortError();
  };
  const assertCurrent = () => {
    assertNotAborted();
    if (!isAuthScopeCurrent(requestAuthScope)) throw abortError();
  };
  assertCurrent();
  let token = await getToken();
  assertCurrent();
  // Signed in on this device with no connection: the first request that reaches the server signs in for real.
  if (token === OFFLINE_TOKEN && path !== "/api/auth/login" && (await resumeOnline())) {
    if (!authScope) requestAuthScope = captureAuthScope();
    token = await getToken();
    assertCurrent();
  }
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (
    !headers.has("content-type") &&
    init.body &&
    typeof init.body === "string"
  ) {
    headers.set("content-type", "application/json");
  }
  if (acceptJson) headers.set("accept", "application/json");
  headers.set("x-vndrly-client", "ios");
  if (token && token !== OFFLINE_TOKEN) headers.set("authorization", `Bearer ${token}`);

  let res: Response;
  try {
    assertCurrent();
    res = await fetch(`${getApiBase()}${path}`, { ...init, headers });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    assertCurrent();
    // fetch() throws on network failure (offline, DNS, TLS, etc.).
    // Tag with a stable code so translateApiError() can localize it.
    const err = new Error(
      e instanceof Error ? e.message : "Network request failed",
    ) as ApiRequestError;
    err.code = "network.unreachable";
    throw err;
  }
  assertCurrent();
  return {
    res,
    token,
    requestAuthScope,
    abortError,
    assertCurrent,
    assertNotAborted,
  };
}

async function assertSuccessfulResponse(
  request: Awaited<ReturnType<typeof scopedRequest>>,
) {
  const {
    res,
    token,
    requestAuthScope,
    abortError,
    assertCurrent,
    assertNotAborted,
  } = request;
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let data: { code?: string; message?: string; error?: string } | null = null;
    try {
      const body = await res.json();
      data = body;
      message = body?.message || body?.error || message;
    } catch {
      // ignore
    }
    assertCurrent();
    // If the server explicitly tells us the session is dead (expired token,
    // signature mismatch, or invalidated by users.session_version bump),
    // wipe local auth so the AuthGate subscriber re-routes the user to
    // /login. We MUST narrow this to specific server-emitted codes —
    // previously this wiped on ANY 401 with a token, which was destructive
    // because several routes (field-employees, accounting-connections,
    // reports, etc.) incorrectly emit 401 for "wrong role" instead of 403.
    // The result was that field_employee users like Joe at Winchester got
    // kicked back to /login the moment they opened a ticket, because some
    // sub-query for a route they aren't authorized to read 401'd and
    // wiped their token. Real auth failures from the central session
    // middleware always carry one of the codes below.
    const sessionDeadCodes = new Set([
      "auth.unauthenticated",
      "auth.not_authenticated",
      "auth.session_invalid",
      "auth.session_expired",
      "auth.token_invalid",
    ]);
    if (
      res.status === 401 &&
      token &&
      data?.code &&
      sessionDeadCodes.has(data.code)
    ) {
      assertCurrent();
      // clearAuthIfCurrent performs its authoritative in-memory mutation
      // synchronously before its persistence promise yields. Capture that
      // expected new generation so it does not cancel the genuine 401.
      const cleanup = clearAuthIfCurrent(requestAuthScope);
      const cleanupScope = captureAuthScope();
      const cleared = await cleanup;
      assertNotAborted();
      // A login that wins during deferred persistence makes this completion stale.
      if (!cleared || !isAuthScopeCurrent(cleanupScope)) throw abortError();
    }
    const err = new Error(message) as ApiRequestError;
    err.status = res.status;
    err.data = data;
    const retryAfter = parseRetryAfter(
      res.headers?.get?.("retry-after") ?? null,
    );
    if (retryAfter !== undefined) err.retryAfterMs = retryAfter;
    // Task #527: ticket-mutation routes (accept/deny/reinvite/PATCH/schedule
    // /unlock/reactivate/disperse-funds) return structured codes via the
    // `error` field — NOT `code`. Fall back to `data.error` so those codes
    // hit translateApiError() and get a localized message instead of the
    // raw "ERR_HTTP_400" placeholder.
    if (data?.code) err.code = data.code;
    else if (data?.error) err.code = data.error;
    if (err.code === "trip.location_consent_required" || err.code === "fleet.device_location_consent_required") {
      const title = "Turn on location sharing";
      const message = "This action needs your device location. Open Profile to turn location sharing back on.";
      const openProfile = () => { void import("expo-router").then(({ router }) => router.push("/profile")); };
      if (Platform.OS === "web") {
        if (window.confirm(message)) openProfile();
      } else {
        Alert.alert(title, message, [
          { text: "Cancel", style: "cancel" },
          { text: "Open Profile", onPress: openProfile },
        ]);
      }
    }
    throw err;
  }
}

export async function apiFetchRaw(
  path: string,
  init: RequestInit = {},
  authScope?: AuthScope,
): Promise<ScopedRawResponse> {
  const request = await scopedRequest(path, init, authScope, false);
  await assertSuccessfulResponse(request);
  const { res, assertCurrent } = request;
  const consume =
    <T>(reader: () => Promise<T>) =>
    async () => {
      assertCurrent();
      const value = await reader();
      assertCurrent();
      return value;
    };
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    url: res.url,
    arrayBuffer: consume(() => res.arrayBuffer()),
    blob: consume(() => res.blob()),
    json: consume(() => res.json()),
    text: consume(() => res.text()),
  };
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  authScope?: AuthScope,
): Promise<T> {
  const request = await scopedRequest(path, init, authScope, true);
  await assertSuccessfulResponse(request);
  const { res, assertCurrent } = request;
  if (res.status === 204) {
    assertCurrent();
    return null as T;
  }
  const text = await res.text();
  assertCurrent();
  if (!text) return null as T;
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    const err = new Error("Invalid JSON response") as Error & { code?: string };
    err.code = "network.parse_error";
    throw err;
  }
  assertCurrent();
  return parsed;
}

type RawMembership = {
  id?: unknown;
  orgType?: unknown;
  orgId?: unknown;
  orgName?: unknown;
  orgLogoUrl?: unknown;
  role?: unknown;
  vendorPeopleId?: unknown;
};

function normalizeMembership(input: unknown): MembershipSummary | null {
  if (!input || typeof input !== "object") return null;
  const m = input as RawMembership;
  if (m.orgType !== "partner" && m.orgType !== "vendor") return null;
  const id = Number(m.id);
  const orgId = Number(m.orgId);
  if (!Number.isFinite(id) || !Number.isFinite(orgId)) return null;
  return {
    id,
    orgType: m.orgType,
    orgId,
    orgName: typeof m.orgName === "string" ? m.orgName : "",
    orgLogoUrl: typeof m.orgLogoUrl === "string" ? m.orgLogoUrl : null,
    role: typeof m.role === "string" ? m.role : "member",
    vendorPeopleId:
      typeof m.vendorPeopleId === "number" ? m.vendorPeopleId : null,
  };
}

function normalizeMemberships(input: unknown): MembershipSummary[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(normalizeMembership)
    .filter((m): m is MembershipSummary => m !== null);
}

function buildStoredUser(
  data: StoredUser & {
    token?: string;
    activeMembershipId?: number | null;
    availableMemberships?: unknown;
  },
): { user: StoredUser; preferredLanguage: "en" | "es" | null } {
  const raw = (data as { preferredLanguage?: string | null }).preferredLanguage;
  const preferredLanguage = raw === "en" || raw === "es" ? raw : null;
  const user: StoredUser = {
    id: data.id,
    username: data.username,
    role: data.role,
    displayName: data.displayName,
    partnerId: data.partnerId,
    vendorId: data.vendorId,
    vendorRole: data.vendorRole ?? null,
    vendorPeopleId: data.vendorPeopleId ?? null,
    managedSubcontractor: data.managedSubcontractor ?? null,
    mustChangePassword: Boolean(data.mustChangePassword),
    preferredLanguage,
    needsLanguageChoice: data.needsLanguageChoice === true,
    activeMembershipId:
      typeof data.activeMembershipId === "number"
        ? data.activeMembershipId
        : null,
    availableMemberships: normalizeMemberships(data.availableMemberships),
    requiresContextChoice: Boolean(
      (data as { requiresContextChoice?: boolean }).requiresContextChoice,
    ),
  };
  return { user, preferredLanguage };
}

let resuming: Promise<boolean> | null = null;
/** True once an offline sign-in has become a real session. A server that still cannot be reached leaves it as it is. */
function resumeOnline(): Promise<boolean> {
  const held = heldOfflineSignIn();
  if (!held) return Promise.resolve(false);
  resuming ??= onlineLogin(held.username, held.password)
    .then(
      () => true,
      async (error: ApiRequestError) => {
        if (error.status === 401 || error.status === 403) {
          // The password or the access changed while offline. What was recorded stays on the device for the next sign-in.
          forgetOfflinePassword();
          await setToken(null);
          await setUser(null);
        }
        throw error;
      },
    )
    .finally(() => {
      resuming = null;
    });
  return resuming;
}

export async function login(
  username: string,
  password: string,
): Promise<StoredUser> {
  try {
    return await onlineLogin(username, password);
  } catch (error) {
    if ((error as ApiRequestError).code !== "network.unreachable") throw error;
    // No connection never keeps a gatekeeper out: a sign-in this device has seen the server accept is good here.
    const user = await offlineSignIn(username, password).catch(() => null);
    if (!user)
      throw Object.assign(
        new Error("No connection. This device can only sign in offline with a username and password that signed in here in the last 30 days."),
        { code: "network.offline_sign_in" },
      );
    await setToken(OFFLINE_TOKEN);
    await setUser(user);
    return user;
  }
}

async function onlineLogin(
  username: string,
  password: string,
): Promise<StoredUser> {
  const data = await apiFetch<
    StoredUser & {
      token: string;
      activeMembershipId?: number | null;
      availableMemberships?: unknown;
    }
  >("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      // Task #837: tell the server which OS locale this device is set to so
      // it can auto-seed `users.preferred_language` on first login. The
      // server only writes when the column is currently null, so this is a
      // safe no-op for users who have already toggled their language.
      clientLocale: readDeviceLocale(),
    }),
  });
  await setToken(data.token);
  const { user, preferredLanguage } = buildStoredUser(data);
  await setUser(user);
  forgetOfflinePassword();
  await rememberSignIn(username, password, user).catch(() => undefined);
  if (preferredLanguage) {
    await setLanguage(preferredLanguage);
  }
  return user;
}

export async function switchContext(membershipId: number): Promise<StoredUser> {
  const data = await apiFetch<
    StoredUser & {
      token: string;
      activeMembershipId?: number | null;
      availableMemberships?: unknown;
    }
  >("/api/auth/switch-context", {
    method: "POST",
    body: JSON.stringify({ membershipId }),
  });
  // The server rotates the bearer token to embed the new active context, so
  // every subsequent request uses the right portal/role.
  if (data.token) await setToken(data.token);
  const { user, preferredLanguage } = buildStoredUser(data);
  await setUser(user);
  await confirmSignIn(user).catch(() => undefined);
  const { clearFleetOfflineOnSignOut } = await import("./fleet-offline-native");
  await clearFleetOfflineOnSignOut();
  if (preferredLanguage) {
    await setLanguage(preferredLanguage);
  }
  return user;
}

export async function refreshAuthMe(): Promise<StoredUser | null> {
  try {
    const data = await apiFetch<
      StoredUser & {
        activeMembershipId?: number | null;
        availableMemberships?: unknown;
      }
    >("/api/auth/me");
    const existing = await getUser();
    const { user } = buildStoredUser({
      ...(existing ?? ({} as StoredUser)),
      ...data,
    } as StoredUser & {
      activeMembershipId?: number | null;
      availableMemberships?: unknown;
    });
    await setUser(user);
    await confirmSignIn(user).catch(() => undefined);
    return user;
  } catch {
    return null;
  }
}

export async function updatePreferredLanguage(
  language: "en" | "es" | "pt",
): Promise<void> {
  const scope = captureAuthScope();
  await apiFetch("/api/auth/me/language", {
    method: "PATCH",
    body: JSON.stringify({ language }),
  }, scope);
  if (!isAuthScopeCurrent(scope)) return;
  const user = await getUser();
  if (!user || !isAuthScopeCurrent(scope)) return;
  if (language === "en" || language === "es") await setLanguage(language);
  if (isAuthScopeCurrent(scope)) await setUser({...user,preferredLanguage:language,needsLanguageChoice:false});
}

export async function logout() {
  forgetOfflinePassword();
  try {
    const { unregisterStoredPushToken } = await import("./push");
    await unregisterStoredPushToken();
  } catch {
    // ignore
  }
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore network errors on logout
  }
  await setToken(null);
  await setUser(null);
  const { clearFleetOfflineOnSignOut } = await import("./fleet-offline-native");
  await clearFleetOfflineOnSignOut();
}
