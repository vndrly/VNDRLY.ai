const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type VisitorRow = {
  id: number;
  firstName: string;
  lastName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  vehiclePlate: string | null;
  purpose: string | null;
  expectedDurationMinutes: number | null;
  hostType: "partner" | "vendor";
  hostPartnerId: number | null;
  hostVendorId: number | null;
  hostPartnerName: string | null;
  hostVendorName: string | null;
  siteLocationId: number;
  siteName: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  autoCheckedOut: boolean;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
};

export type PublicSite = {
  id: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  state: string | null;
  siteCode: string;
  partnerName: string | null;
};

export type SiteContext = {
  site: {
    id: number;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    siteRadiusMeters: number;
    siteCode: string;
  };
  partner: {
    id: number;
    name: string;
    logoUrl: string | null;
    // Square (1:1) crop of the partner logo for tightly-bounded badges;
    // falls back to logoUrl when the partner only uploaded a wide
    // wordmark. Mirrors the shape used by the authenticated `useBrand`
    // payload so visit-public can reuse the same fallback chain.
    logoSquareUrl: string | null;
    brandPrimaryColor: string | null;
    brandAccentColor: string | null;
  } | null;
  vendors: { id: number; name: string }[];
};

async function jf<T>(path: string, init?: RequestInit, opts?: { auth?: "staff" | "guest" | "none" }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...((init?.headers as Record<string, string>) ?? {}) };
  const res = await fetch(`${BASE}${path}`, { credentials: "include", headers, ...init });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let data: any = null;
    try { data = await res.json(); if (data?.message) msg = data.message; } catch {}
    const err = new Error(msg) as Error & { data?: any; status?: number; headers?: Headers };
    err.data = data;
    err.status = res.status;
    err.headers = res.headers;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type VisitorDetail = VisitorRow & {
  sitePartnerId: number | null;
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
};

export const visitsApi = {
  list: (params?: { siteLocationId?: number; from?: string; to?: string }) => {
    const qs: string[] = [];
    if (params?.siteLocationId) qs.push(`siteLocationId=${params.siteLocationId}`);
    if (params?.from) qs.push(`from=${encodeURIComponent(params.from)}`);
    if (params?.to) qs.push(`to=${encodeURIComponent(params.to)}`);
    return jf<VisitorRow[]>(`/api/visits${qs.length ? `?${qs.join("&")}` : ""}`);
  },
  get: (id: number) => jf<VisitorDetail>(`/api/visits/${id}`),
  getSiteContext: (siteCode: string) => jf<SiteContext>(`/api/visits/site-context/${encodeURIComponent(siteCode)}`),
  listPublicSites: () => jf<PublicSite[]>(`/api/visits/public-sites`),
  startGuestSession: (input: {
    firstName: string;
    lastName: string;
    phone?: string;
    email?: string;
    company?: string;
    vehiclePlate?: string;
    purpose?: string;
    safetyAcknowledged: boolean;
  }) => jf<{ token: string; guestSessionId: number; expiresAt: string }>(`/api/auth/guest`, { method: "POST", body: JSON.stringify(input) }),
  guestMe: () => jf<unknown>(`/api/auth/guest/me`),
  guestLogout: () => jf<void>(`/api/auth/guest/logout`, { method: "POST" }),
  checkIn: (input: {
    siteLocationId: number;
    hostType: "partner" | "vendor";
    hostPartnerId?: number;
    hostVendorId?: number;
    purpose?: string;
    expectedDurationMinutes?: number;
    vehiclePlate?: string;
    latitude: number;
    longitude: number;
  }) => jf<VisitorRow>(`/api/visits/check-in`, { method: "POST", body: JSON.stringify(input) }),
  myActive: () => jf<VisitorRow | null>(`/api/visits/me/active`),
  checkOut: (id: number, latitude?: number, longitude?: number) =>
    jf<VisitorRow>(`/api/visits/${id}/check-out`, { method: "POST", body: JSON.stringify({ latitude, longitude }) }),
};
