import { useQuery } from "@tanstack/react-query";

export const HSE_COMPANY_ROLE = "HSE / Safety Officer";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type SafetyTrainingModule = {
  id: number;
  title: string;
  description: string | null;
  videoUrl: string;
  requiredRoles: string[];
  version: number;
  isActive: boolean;
};

export type SafetyTrainingStatus = {
  incompleteModules: SafetyTrainingModule[];
  allComplete: boolean;
};

export type SafetyCapabilities = {
  isPartnerHse: boolean;
};

export type SafetyEventListItem = {
  id: number;
  eventNumber: string;
  title: string;
  status: string;
  isStopWork: boolean;
};

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed (${r.status})`);
  }
  const json = await r.json();
  return json.data as T;
}

export async function fetchSafetyCapabilities(): Promise<SafetyCapabilities> {
  return readJson<SafetyCapabilities>("/api/safety/capabilities");
}

export async function fetchSafetyTrainingStatus(): Promise<SafetyTrainingStatus> {
  return readJson<SafetyTrainingStatus>("/api/safety/training/status");
}

export async function reactivateSiteLocation(siteId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/api/site-locations/${siteId}/status`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.message ?? "Failed to reactivate site");
  }
}

export async function fetchOpenStopWorkEvents(siteId: number): Promise<SafetyEventListItem[]> {
  const q = new URLSearchParams({
    siteId: String(siteId),
    openOnly: "true",
    limit: "20",
  });
  const rows = await readJson<SafetyEventListItem[]>(`/api/safety/events?${q}`);
  return rows.filter((row) => row.isStopWork);
}

export async function addSafetyEventNote(eventId: number, body: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/safety/events/${eventId}/notes`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => null);
    throw new Error(err?.message ?? "Failed to add resolution note");
  }
}

export async function closeSafetyEvent(eventId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/api/safety/events/${eventId}/close`, {
    method: "POST",
    credentials: "include",
  });
  if (!r.ok) {
    const err = await r.json().catch(() => null);
    throw new Error(err?.message ?? "Failed to close safety event");
  }
}

export async function closeStopWorkAndReactivateSite(
  siteId: number,
  events: SafetyEventListItem[],
  resolutionNote: string,
): Promise<void> {
  for (const event of events) {
    await addSafetyEventNote(event.id, resolutionNote);
    await closeSafetyEvent(event.id);
  }
  await reactivateSiteLocation(siteId);
}

export async function completeSafetyTrainingModule(moduleId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/api/safety/training/${moduleId}/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watchProgressPct: 100 }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.message ?? "Failed to mark training complete");
  }
}

export function useSafetyCapabilities() {
  return useQuery({
    queryKey: ["safety-capabilities"],
    queryFn: fetchSafetyCapabilities,
    staleTime: 60_000,
  });
}

export function useSafetyTrainingStatus() {
  return useQuery({
    queryKey: ["safety-training-status"],
    queryFn: fetchSafetyTrainingStatus,
    staleTime: 60_000,
  });
}
