import { apiFetch } from "./api";
import { setToken, setUser } from "./auth";
import type { PlateStateCode } from "@workspace/plate-state";

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

export type GuestSession = {
  token: string;
  guestSessionId: number;
  role: "guest";
  expiresAt: string;
  profile: GuestProfile;
};

export type GuestSessionRead = Omit<GuestSession, "token">;

export type PreferredPlateStatesResponse = {
  preferred: PlateStateCode[];
};

export type GuestSignUpInput = {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  company?: string;
  vehiclePlate?: string;
  plateState?: string;
  purpose?: string;
  safetyAcknowledged: boolean;
};

export async function startGuestSession(
  input: GuestSignUpInput,
): Promise<GuestSession> {
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

export async function fetchGuestSession(): Promise<GuestSessionRead> {
  return apiFetch<GuestSessionRead>("/api/auth/guest/me");
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
  return apiFetch<SiteContext>(
    `/api/visits/site-context/${encodeURIComponent(siteCode)}`,
  );
}

export async function fetchPreferredPlateStates(
  siteId: number,
  siteCode: string,
): Promise<PreferredPlateStatesResponse> {
  return apiFetch<PreferredPlateStatesResponse>(
    `/api/visits/sites/${siteId}/preferred-plate-states?siteCode=${encodeURIComponent(siteCode)}`,
  );
}

export type PublicSite = {
  id: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  siteRadiusMeters: number;
  siteCode: string;
  partnerName?: string | null;
};

export async function fetchPublicSites(): Promise<PublicSite[]> {
  return apiFetch<PublicSite[]>("/api/visits/public-sites");
}

export type ActiveVisit = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  siteLocationId: number;
  siteName: string | null;
  siteAddress: string | null;
  hostType: string;
  hostPartnerName: string | null;
  hostVendorName: string | null;
  purpose: string | null;
  notes?: string | null;
  checkOutNotes?: string | null;
  admissionStatus?: "pending" | "admitted" | null;
  vehiclePlate: string | null;
  plateState: PlateStateCode | null;
  platePhotoUrl: string | null;
  vehiclePhotoUrl: string | null;
  expectedDurationMinutes: number | null;
  checkInTime: string;
  checkOutTime?: string | null;
  observedArrivalAt?: string | null;
  observedDepartureAt?: string | null;
  observationSource?: "camera" | "gatekeeper" | "geofence" | "driver" | null;
  reconciliationState?: "not_required" | "observed" | "reconciled" | "needs_supervisor_review";
  conflictReason?: string | null;
  reconciledAt?: string | null;
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
  notes?: string;
  expectedDurationMinutes?: number;
  vehiclePlate?: string;
  plateState?: string;
  platePhotoUrl?: string;
  vehiclePhotoUrl?: string;
  latitude: number;
  longitude: number;
}): Promise<{ id: number }> {
  return apiFetch<{ id: number }>("/api/visits/check-in", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function visitorCheckOut(
  visitId: number,
  latitude?: number,
  longitude?: number,
  notes?: string,
): Promise<void> {
  await apiFetch(`/api/visits/${visitId}/check-out`, {
    method: "POST",
    body: JSON.stringify({ latitude, longitude, notes }),
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
