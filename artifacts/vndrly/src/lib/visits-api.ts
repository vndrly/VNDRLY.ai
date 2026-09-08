import type { PlateStateCode } from "@workspace/plate-state";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type VisitorRow = {
  id: number;
  firstName: string;
  lastName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  vehiclePlate: string | null;
  plateState: PlateStateCode | null;
  platePhotoUrl: string | null;
  vehiclePhotoUrl: string | null;
  purpose: string | null;
  entryCategory?: "visitor" | "routine_vendor_work" | "partner_admin" | "vendor_admin" | null;
  notes?: string | null;
  checkOutNotes?: string | null;
  admissionStatus?: "pending" | "admitted";
  expectedDurationMinutes: number | null;
  hostType: "partner" | "vendor";
  hostPartnerId: number | null;
  hostVendorId: number | null;
  hostPartnerName: string | null;
  hostVendorName: string | null;
  siteLocationId: number;
  siteName: string | null;
  siteCode?: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  autoCheckedOut: boolean;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
};

export type AssignedGateSite = {
  id: number;
  name: string;
  address: string;
  siteCode: string;
  latitude: number;
  longitude: number;
  assignmentId: number;
  partnerId: number;
  partnerName: string;
};

export type AssignedGateSitesResponse = {
  sites: AssignedGateSite[];
  defaultSite: AssignedGateSite | null;
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

async function jf<T>(
  path: string,
  init?: RequestInit,
  opts?: { auth?: "staff" | "guest" | "none" },
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers,
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let data: any = null;
    try {
      data = await res.json();
      if (data?.message) msg = data.message;
    } catch {}
    const err = new Error(msg) as Error & {
      data?: any;
      status?: number;
      headers?: Headers;
    };
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

export type GuestProfile = {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  vehiclePlate: string | null;
  plateState: PlateStateCode | null;
  lastPurpose: string | null;
};

export type GuestSessionResponse = {
  token: string;
  guestSessionId: number;
  role: "guest";
  expiresAt: string;
  profile: GuestProfile;
};

export type GuestSessionRead = Omit<GuestSessionResponse, "token">;

export type PlateOcrCandidate = {
  plate: string | null;
  state: PlateStateCode | null;
  plateConfidence: number | null;
  stateConfidence: number | null;
};

export type PreferredPlateStatesResponse = {
  preferred: PlateStateCode[];
};

export const visitsApi = {
  list: (params?: {
    siteLocationId?: number;
    from?: string;
    to?: string;
    activeOnly?: boolean;
    overlap?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const qs: string[] = [];
    if (params?.siteLocationId)
      qs.push(`siteLocationId=${params.siteLocationId}`);
    if (params?.from) qs.push(`from=${encodeURIComponent(params.from)}`);
    if (params?.to) qs.push(`to=${encodeURIComponent(params.to)}`);
    if (params?.activeOnly) qs.push("activeOnly=true");
    if (params?.overlap) qs.push("overlap=true");
    if (params?.limit) qs.push(`limit=${params.limit}`);
    if (params?.offset) qs.push(`offset=${params.offset}`);
    return jf<VisitorRow[]>(
      `/api/visits${qs.length ? `?${qs.join("&")}` : ""}`,
    );
  },
  get: (id: number) => jf<VisitorDetail>(`/api/visits/${id}`),
  getSiteContext: (siteCode: string) =>
    jf<SiteContext>(`/api/visits/site-context/${encodeURIComponent(siteCode)}`),
  listAssignedGateSites: () =>
    jf<AssignedGateSitesResponse>(`/api/visits/gate/assigned-sites`),
  listPreferredPlateStates: (siteId: number, siteCode?: string) => {
    const proof = siteCode ? `?siteCode=${encodeURIComponent(siteCode)}` : "";
    return jf<PreferredPlateStatesResponse>(
      `/api/visits/sites/${siteId}/preferred-plate-states${proof}`,
    );
  },
  listPublicSites: (siteCode: string) => jf<PublicSite[]>(`/api/visits/public-sites?siteCode=${encodeURIComponent(siteCode)}`),
  startGuestSession: (input: {
    firstName: string;
    lastName: string;
    phone?: string;
    email?: string;
    company?: string;
    vehiclePlate?: string;
    plateState?: string;
    purpose?: string;
    safetyAcknowledged: boolean;
  }) =>
    jf<GuestSessionResponse>(`/api/auth/guest`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  guestMe: () => jf<GuestSessionRead>(`/api/auth/guest/me`),
  guestLogout: () => jf<void>(`/api/auth/guest/logout`, { method: "POST" }),
  checkIn: (input: {
    siteLocationId: number;
    hostType: "partner" | "vendor";
    hostPartnerId?: number;
    hostVendorId?: number;
    purpose?: string;
    notes?: string;
    expectedDurationMinutes?: number;
    vehiclePlate?: string;
    plateState?: string;
    platePhotoUrl?: string;
    vehiclePhotoUrl?: string;
    latitude: number;
    longitude: number;
  }) =>
    jf<VisitorRow>(`/api/visits/check-in`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  myActive: () => jf<VisitorRow | null>(`/api/visits/me/active`),
  checkOut: (id: number, latitude?: number, longitude?: number, notes?: string) =>
    jf<VisitorRow>(`/api/visits/${id}/check-out`, {
      method: "POST",
      body: JSON.stringify({ latitude, longitude, notes }),
    }),
  gateCheckIn: (input: {
    firstName: string;
    lastName: string;
    company?: string;
    phone?: string;
    email?: string;
    siteLocationId: number;
    hostType: "partner" | "vendor";
    hostPartnerId?: number;
    hostVendorId?: number;
    purpose?: string;
    entryCategory?: VisitorRow["entryCategory"];
    notes?: string;
    expectedDurationMinutes?: number;
    vehiclePlate?: string;
    plateState?: string;
    platePhotoUrl?: string;
    vehiclePhotoUrl?: string;
    latitude: number;
    longitude: number;
  }) =>
    jf<VisitorRow>(`/api/visits/gate/check-in`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  gateCheckOut: (id: number, latitude?: number, longitude?: number, notes?: string) =>
    jf<VisitorRow>(`/api/visits/gate/${id}/check-out`, {
      method: "POST",
      body: JSON.stringify({ latitude, longitude, notes }),
    }),
  setEntryCategory: (id: number, entryCategory: VisitorRow["entryCategory"]) =>
    jf<{ id: number; entryCategory: VisitorRow["entryCategory"] }>(`/api/visits/${id}/entry-category`, { method: "PATCH", body: JSON.stringify({ entryCategory }) }),
  gateAdmit: (id: number) =>
    jf<VisitorRow>(`/api/visits/gate/${id}/admit`, {
      method: "POST",
    }),
  readPlate: (input: { objectPath: string }) =>
    jf<PlateOcrCandidate>(`/api/visits/gate/read-plate`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  gateEnabled: () => jf<{ enabled: boolean }>(`/api/visits/gate/enabled`),
  gateOps: () =>
    jf<{
      enabled: boolean;
      visits: VisitorRow[];
      staff: {
        employeeId: number;
        userId: number | null;
        firstName: string;
        lastName: string;
        vendorName: string | null;
      }[];
      recordedVisits: {
        recordedByUserId: number | null;
        checkInTime: string;
        checkOutTime: string | null;
      }[];
      checkIns: {
        employeeId: number;
        checkInAt: string;
        checkOutAt: string | null;
      }[];
    }>(`/api/visits/gate/ops`),
};

export async function listAllVisits(params?: {
  siteLocationId?: number;
  from?: string;
  to?: string;
  activeOnly?: boolean;
  overlap?: boolean;
}): Promise<VisitorRow[]> {
  const rows: VisitorRow[] = [];
  const pageSize = 1000;
  // Historical visitor browsing is bounded by default; Gate Log exports use
  // the immutable combined report service instead of polling every old visit.
  const boundedParams = { ...params, from: params?.from || new Date(Date.now() - 7 * 86_400_000).toISOString(), to: params?.to || new Date().toISOString() };
  for (let offset = 0; ; offset += pageSize) {
    const page = await visitsApi.list({ ...boundedParams, limit: pageSize, offset });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
