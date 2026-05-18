import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import i18n from "@/lib/i18n";

type AuthErrorBody = { error?: string; code?: string; message?: string };

class AuthApiError extends Error {
  status: number;
  data: AuthErrorBody | null;
  constructor(status: number, data: AuthErrorBody | null, fallbackMessage: string) {
    const msg =
      (data && typeof data.message === "string" && data.message) ||
      (data && typeof data.error === "string" && data.error) ||
      fallbackMessage;
    super(msg);
    this.name = "AuthApiError";
    this.status = status;
    this.data = data;
  }
}

async function readAuthErrorBody(res: Response): Promise<AuthErrorBody | null> {
  try {
    const body = await res.json();
    if (body && typeof body === "object") return body as AuthErrorBody;
    return null;
  } catch {
    return null;
  }
}

export interface MembershipSummary {
  id: number;
  orgType: "partner" | "vendor";
  orgId: number;
  orgName: string;
  orgLogoUrl: string | null;
  role: string;
  vendorPeopleId: number | null;
}

interface AuthUser {
  userId: number;
  role: "admin" | "vendor" | "partner" | "field_employee";
  displayName: string;
  partnerId: number | null;
  vendorId: number | null;
  // For vendor sessions: vendor_people.vendor_role of the active membership
  // ('field' | 'foreman' | 'office' | 'both' | null). Used by the UI to
  // decide whether to surface office-only affordances like phone intake.
  vendorRole: "field" | "foreman" | "office" | "both" | null;
  preferredLanguage: "en" | "es" | null;
  activeMembershipId: number | null;
  availableMemberships: MembershipSummary[];
  requiresContextChoice: boolean;
  mustChangePassword: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setPreferredLanguage: (lng: "en" | "es") => void;
  switchContext: (membershipId: number) => Promise<void>;
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function applyLanguage(lng: string | null | undefined) {
  if (lng === "en" || lng === "es") {
    if (i18n.language !== lng) {
      void i18n.changeLanguage(lng);
    }
  }
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

type RawAuthResponse = {
  userId?: unknown;
  id?: unknown;
  role?: unknown;
  displayName?: unknown;
  partnerId?: unknown;
  vendorId?: unknown;
  vendorRole?: unknown;
  preferredLanguage?: unknown;
  activeMembershipId?: unknown;
  availableMemberships?: unknown;
  requiresContextChoice?: unknown;
  mustChangePassword?: unknown;
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

function fromResponse(input: unknown): AuthUser {
  const data = (input ?? {}) as RawAuthResponse;
  const memberships: MembershipSummary[] = Array.isArray(data.availableMemberships)
    ? data.availableMemberships
        .map(normalizeMembership)
        .filter((m): m is MembershipSummary => m !== null)
    : [];
  const role: AuthUser["role"] =
    data.role === "admin" ||
    data.role === "vendor" ||
    data.role === "partner" ||
    data.role === "field_employee"
      ? data.role
      : "field_employee";
  const vendorRole: AuthUser["vendorRole"] =
    data.vendorRole === "field" ||
    data.vendorRole === "foreman" ||
    data.vendorRole === "office" ||
    data.vendorRole === "both"
      ? data.vendorRole
      : null;
  return {
    userId: Number(data.userId ?? data.id ?? 0),
    role,
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    partnerId: typeof data.partnerId === "number" ? data.partnerId : null,
    vendorId: typeof data.vendorId === "number" ? data.vendorId : null,
    vendorRole,
    preferredLanguage:
      data.preferredLanguage === "en" || data.preferredLanguage === "es"
        ? data.preferredLanguage
        : null,
    activeMembershipId:
      typeof data.activeMembershipId === "number" ? data.activeMembershipId : null,
    availableMemberships: memberships,
    requiresContextChoice: Boolean(data.requiresContextChoice),
    mustChangePassword: Boolean(data.mustChangePassword),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/auth/me`, { credentials: "include" })
      .then(async (r) => {
        if (r.ok) return r.json();
        const body = await readAuthErrorBody(r);
        throw new AuthApiError(r.status, body, "Not authenticated");
      })
      .then((data) => {
        const next = fromResponse(data);
        setUser(next);
        applyLanguage(next.preferredLanguage);
      })
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await readAuthErrorBody(res);
      throw new AuthApiError(res.status, body, "Login failed");
    }
    const data = await res.json();
    const next = fromResponse(data);
    setUser(next);
    applyLanguage(next.preferredLanguage);
  }, []);

  const logout = useCallback(async () => {
    // Best-effort: clear the server session. Swallow network errors so a
    // transient failure can't trap the user on an authenticated page.
    try {
      await fetch(`${BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    setUser(null);
    // Hard navigate to the login page. A full reload is intentional here:
    // it tears down react-query caches, SSE streams (notifications/tickets
    // events), and any in-memory subscribers that would otherwise keep
    // serving stale authenticated data after the cookie is gone.
    window.location.replace(`${BASE}/`);
  }, []);

  const setPreferredLanguage = useCallback((lng: "en" | "es") => {
    setUser((prev) => (prev ? { ...prev, preferredLanguage: lng } : prev));
  }, []);

  const clearMustChangePassword = useCallback(() => {
    setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
  }, []);

  const switchContext = useCallback(async (membershipId: number) => {
    const res = await fetch(`${BASE}/api/auth/switch-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ membershipId }),
    });
    if (!res.ok) {
      const body = await readAuthErrorBody(res);
      throw new AuthApiError(res.status, body, "Failed to switch context");
    }
    const data = await res.json();
    const next = fromResponse(data);
    setUser(next);
    applyLanguage(next.preferredLanguage);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, logout, setPreferredLanguage, switchContext, clearMustChangePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Stable fallback used when `useAuth` is called outside an `AuthProvider`.
// This happens during Vite HMR: editing `use-auth.tsx` creates a fresh
// `AuthContext` instance, but consumers like `BrandProvider` may still hold
// the previous reference for one render and would otherwise see `null` and
// crash. It also lets `BrandProvider` and similar UI render safely from
// tests, Storybook, or any future surface that doesn't mount auth (e.g. a
// public landing page).
//
// The shape mirrors `AuthContextType` exactly so callers don't need to
// branch. Mutating methods are no-ops; they should never run in practice
// because the only legitimate caller of this fallback is a render that
// hasn't been re-wrapped in an `AuthProvider` yet. If it does run, the
// rejection makes the misuse loud without crashing the React subtree.
const FALLBACK_AUTH: AuthContextType = {
  user: null,
  isLoading: false,
  login: async () => {
    throw new Error("useAuth: login called outside AuthProvider");
  },
  logout: async () => {},
  setPreferredLanguage: () => {},
  switchContext: async () => {
    throw new Error("useAuth: switchContext called outside AuthProvider");
  },
  clearMustChangePassword: () => {},
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  return ctx ?? FALLBACK_AUTH;
}

// Strict variant for code paths that genuinely require an authenticated
// provider (e.g. action handlers behind login walls). Most UI should use
// the lenient `useAuth` above.
export function useAuthStrict(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthStrict must be used within AuthProvider");
  return ctx;
}
