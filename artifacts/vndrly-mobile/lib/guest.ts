import { apiFetch } from "./api";
import { setToken, setUser } from "./auth";

export type GuestProfile = {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  vehiclePlate: string | null;
  lastPurpose: string | null;
};

export type GuestSession = {
  token: string;
  guestSessionId: number;
  role: "guest";
  expiresAt: string;
  profile: GuestProfile;
};

export type GuestSignUpInput = {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  company?: string;
  vehiclePlate?: string;
  purpose?: string;
  safetyAcknowledged: boolean;
};

export async function startGuestSession(input: GuestSignUpInput): Promise<GuestSession> {
  const data = await apiFetch<GuestSession>("/api/auth/guest", {
    method: "POST",
    body: JSON.stringify(input),
  });
  await setToken(data.token);
  await setUser({
    id: -data.guestSessionId,
    username: `${input.firstName} ${input.lastName}`,
    role: "guest",
    displayName: `${input.firstName} ${input.lastName}`,
    partnerId: null,
    vendorId: null,
  });
  return data;
}

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
  partner: { id: number; name: string } | null;
  vendors: { id: number; name: string }[];
};

export async function fetchSiteContext(siteCode: string): Promise<SiteContext> {
  return apiFetch<SiteContext>(`/api/visits/site-context/${encodeURIComponent(siteCode)}`);
}

export type ActiveVisit = {
  id: number;
  siteLocationId: number;
  siteName: string | null;
  siteAddress: string | null;
  hostType: string;
  hostPartnerName: string | null;
  hostVendorName: string | null;
  purpose: string | null;
  expectedDurationMinutes: number | null;
  checkInTime: string;
  expiresAt: string | null;
};

export async function fetchActiveVisit(): Promise<ActiveVisit | null> {
  return apiFetch<ActiveVisit | null>("/api/visits/me/active");
}

export async function visitorCheckIn(input: {
  siteLocationId: number;
  hostType: "partner" | "vendor";
  hostPartnerId?: number;
  hostVendorId?: number;
  purpose?: string;
  expectedDurationMinutes?: number;
  vehiclePlate?: string;
  latitude: number;
  longitude: number;
}): Promise<{ id: number }> {
  return apiFetch<{ id: number }>("/api/visits/check-in", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function visitorCheckOut(visitId: number, latitude?: number, longitude?: number): Promise<void> {
  await apiFetch(`/api/visits/${visitId}/check-out`, {
    method: "POST",
    body: JSON.stringify({ latitude, longitude }),
  });
}

export async function guestLogout(): Promise<void> {
  try {
    await apiFetch("/api/auth/guest/logout", { method: "POST" });
  } catch {
    // ignore
  }
  await setToken(null);
  await setUser(null);
}
