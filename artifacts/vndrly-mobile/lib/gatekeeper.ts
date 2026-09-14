import * as Location from "expo-location";

import { apiFetch } from "./api";
import type { AssignedGateSitesResponse } from "./gate-default-site";
import type { ActiveVisit, SiteContext } from "./guest";
import type { PlateStateCode } from "@workspace/plate-state";
import { buildHostOptions, parseDurationMinutes } from "./visitorCheckin";

export type GatekeeperVisitInput = {
  ctx: SiteContext;
  hostKey: string;
  firstName: string;
  lastName: string;
  company: string;
  vehiclePlate: string;
  plateState: PlateStateCode | null;
  purpose: string;
  notes?: string;
  durationStr: string;
  platePhotoUrl?: string;
  vehiclePhotoUrl?: string;
};

export type GatekeeperSubmitResult =
  | { ok: true; visitId: number }
  | {
      ok: false;
      reason:
        | "missing-name"
        | "missing-plate"
        | "no-host"
        | "location-denied";
    };

export type PreferredPlateStatesResponse = {
  preferred: PlateStateCode[];
};

export async function fetchGatekeeperVisits(): Promise<ActiveVisit[]> {
  return apiFetch<Array<ActiveVisit & { checkOutTime?: string | null }>>(
    "/api/visits?activeOnly=true&limit=1000",
  );
}

export async function fetchAssignedGateSites(): Promise<AssignedGateSitesResponse> {
  return apiFetch("/api/visits/gate/assigned-sites");
}

export async function fetchPreferredPlateStates(
  siteId: number,
  siteCode?: string,
): Promise<PreferredPlateStatesResponse> {
  const proof = siteCode ? `?siteCode=${encodeURIComponent(siteCode)}` : "";
  return apiFetch(`/api/visits/sites/${siteId}/preferred-plate-states${proof}`);
}

export async function fetchGatekeeperHistory(
  fromIso: string,
): Promise<ActiveVisit[]> {
  return fetchVisitPages(`from=${encodeURIComponent(fromIso)}`);
}

export async function fetchGatekeeperRecentVisits(): Promise<ActiveVisit[]> {
  return fetchVisitPages("");
}

async function fetchVisitPages(prefix: string): Promise<ActiveVisit[]> {
  const rows: ActiveVisit[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const query = [prefix, `limit=${pageSize}`, `offset=${offset}`]
      .filter(Boolean)
      .join("&");
    const page = await apiFetch<ActiveVisit[]>(`/api/visits?${query}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export type PlateOcrCandidate = {
  plate: string | null;
  state: PlateStateCode | null;
  plateConfidence: number | null;
  stateConfidence: number | null;
};

export async function readGatePlate(
  objectPath: string,
): Promise<PlateOcrCandidate> {
  return apiFetch<PlateOcrCandidate>("/api/visits/gate/read-plate", {
    method: "POST",
    body: JSON.stringify({ objectPath }),
  });
}

export async function deleteGateEvidence(
  objectPath: string | null,
): Promise<void> {
  if (!objectPath) return;
  await apiFetch("/api/storage/uploads", {
    method: "DELETE",
    body: JSON.stringify({ objectPath }),
  });
}

export async function gatekeeperCheckOut(
  visitId: number,
  notes?: string,
): Promise<void> {
  let latitude: number | undefined;
  let longitude: number | undefined;
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status === "granted") {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    }
  } catch {
    // GPS is best-effort for check-out; the server still records time-out.
  }
  await apiFetch(`/api/visits/gate/${visitId}/check-out`, {
    method: "POST",
    body: JSON.stringify({ latitude, longitude, notes }),
  });
}

export async function gateAdmit(visitId: number): Promise<void> {
  await apiFetch(`/api/visits/gate/${visitId}/admit`, { method: "POST" });
}

export async function submitGatekeeperVisit(
  input: GatekeeperVisitInput,
): Promise<GatekeeperSubmitResult> {
  if (!input.firstName.trim() || !input.lastName.trim()) {
    return { ok: false, reason: "missing-name" };
  }
  if (!input.vehiclePlate.trim()) return { ok: false, reason: "missing-plate" };
  const host = buildHostOptions(input.ctx).find((o) => o.key === input.hostKey);
  if (!host) return { ok: false, reason: "no-host" };

  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted")
    return { ok: false, reason: "location-denied" };
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  const res = await apiFetch<{ id: number }>("/api/visits/gate/check-in", {
    method: "POST",
    body: JSON.stringify({
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      company: input.company.trim() || undefined,
      siteLocationId: input.ctx.site.id,
      hostType: host.type,
      hostPartnerId: host.type === "partner" ? host.id : undefined,
      hostVendorId: host.type === "vendor" ? host.id : undefined,
      vehiclePlate: input.vehiclePlate.trim() || undefined,
      plateState: input.plateState ?? undefined,
      purpose: input.purpose.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      expectedDurationMinutes: parseDurationMinutes(input.durationStr),
      ...(input.platePhotoUrl ? { platePhotoUrl: input.platePhotoUrl } : {}),
      ...(input.vehiclePhotoUrl
        ? { vehiclePhotoUrl: input.vehiclePhotoUrl }
        : {}),
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    }),
  });
  return { ok: true, visitId: res.id };
}

export async function observeGateCrossing(input: {
  siteLocationId: number;
  direction: "entry" | "exit";
  source: "camera" | "gatekeeper" | "geofence" | "driver";
  observedAt: string;
  plate?: string;
  plateState?: string;
}): Promise<ActiveVisit> {
  return apiFetch("/api/visits/gate/observations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function reconcileGateVisit(
  visitId: number,
  input: {
    firstName: string;
    lastName: string;
    company: string;
    plate?: string;
    plateState?: string;
    overrideReason?: string;
  },
): Promise<ActiveVisit> {
  return apiFetch("/api/visits/gate/" + visitId + "/reconcile", {
    method: "POST",
    body: JSON.stringify(input),
  });
}