import { apiFetch } from "@/lib/api";

export const HSE_COMPANY_ROLE = "HSE / Safety Officer";

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

export type SafetyMetrics = {
  safetyScore: number;
  daysWithoutRecordable: number | null;
  openEventCount: number;
  openHipoCount: number;
};

type ApiEnvelope<T> = { success?: boolean; data: T };

export async function fetchSafetyCapabilities(): Promise<SafetyCapabilities> {
  const json = await apiFetch<ApiEnvelope<SafetyCapabilities>>("/api/safety/capabilities");
  return json.data;
}

export async function fetchSafetyMetrics(): Promise<SafetyMetrics> {
  const json = await apiFetch<ApiEnvelope<SafetyMetrics>>("/api/safety/metrics");
  return json.data;
}

export async function fetchSafetyTrainingStatus(): Promise<SafetyTrainingStatus> {
  const json = await apiFetch<ApiEnvelope<SafetyTrainingStatus>>("/api/safety/training/status");
  return json.data;
}

export async function reactivateSiteLocation(siteId: number): Promise<void> {
  await apiFetch(`/api/site-locations/${siteId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
}

export async function completeSafetyTrainingModule(moduleId: number): Promise<void> {
  await apiFetch(`/api/safety/training/${moduleId}/complete`, {
    method: "POST",
    body: JSON.stringify({ watchProgressPct: 100 }),
  });
}
