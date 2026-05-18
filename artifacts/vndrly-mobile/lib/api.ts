import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import * as Localization from "expo-localization";

import {
  getToken,
  getUser,
  setToken,
  setUser,
  type MembershipSummary,
  type StoredUser,
} from "./auth";
import { setLanguage } from "./i18n";

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
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not set. Start the app via `pnpm dev` so the dev script injects it.",
    );
  }
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

let _initialized = false;
export function initApi() {
  if (_initialized) return;
  _initialized = true;
  setBaseUrl(getApiBase());
  setAuthTokenGetter(() => getToken());
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (!headers.has("content-type") && init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, { ...init, headers });
  } catch (e) {
    // fetch() throws on network failure (offline, DNS, TLS, etc.).
    // Tag with a stable code so translateApiError() can localize it.
    const err = new Error(
      e instanceof Error ? e.message : "Network request failed",
    ) as Error & { status?: number; data?: unknown; code?: string };
    err.code = "network.unreachable";
    throw err;
  }
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
    if (res.status === 401 && token && data?.code && sessionDeadCodes.has(data.code)) {
      try {
        await setToken(null);
        await setUser(null);
      } catch {
        // best effort — never let cleanup mask the original error
      }
    }
    const err = new Error(message) as Error & {
      status?: number;
      data?: unknown;
      code?: string;
    };
    err.status = res.status;
    err.data = data;
    // Task #527: ticket-mutation routes (accept/deny/reinvite/PATCH/schedule
    // /unlock/reactivate/disperse-funds) return structured codes via the
    // `error` field — NOT `code`. Fall back to `data.error` so those codes
    // hit translateApiError() and get a localized message instead of the
    // raw "ERR_HTTP_400" placeholder.
    if (data?.code) err.code = data.code;
    else if (data?.error) err.code = data.error;
    throw err;
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
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
  const preferredLanguage =
    raw === "en" || raw === "es" ? raw : null;
  const user: StoredUser = {
    id: data.id,
    username: data.username,
    role: data.role,
    displayName: data.displayName,
    partnerId: data.partnerId,
    vendorId: data.vendorId,
    vendorRole: data.vendorRole ?? null,
    vendorPeopleId: data.vendorPeopleId ?? null,
    preferredLanguage,
    activeMembershipId:
      typeof data.activeMembershipId === "number" ? data.activeMembershipId : null,
    availableMemberships: normalizeMemberships(data.availableMemberships),
  };
  return { user, preferredLanguage };
}

export async function login(username: string, password: string): Promise<StoredUser> {
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
    return user;
  } catch {
    return null;
  }
}

export async function updatePreferredLanguage(language: "en" | "es" | "pt"): Promise<void> {
  await apiFetch("/api/auth/me/language", {
    method: "PATCH",
    body: JSON.stringify({ language }),
  });
}

export async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore network errors on logout
  }
  await setToken(null);
  await setUser(null);
}
