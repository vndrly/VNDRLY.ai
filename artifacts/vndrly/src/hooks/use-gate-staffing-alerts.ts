import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GateStaffingAlert, GateStaffingAlertsResponse } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { withRequestDeadline } from "@/lib/request-deadline";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function staffingRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return withRequestDeadline(async signal => {
    const response = await fetch(`${BASE}/api/gate-staffing-alerts${path}`, {
      credentials: "include", ...init, signal,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(body?.message ?? body?.error ?? "Staffing status could not be confirmed."), { status: response.status });
    if (!body) throw new Error("Staffing status could not be confirmed.");
    return body as T;
  }, { signal: init?.signal, timeoutMs: 30_000, timeoutMessage: "Staffing status could not be confirmed. Reload the saved status before retrying." });
}

/** Every surface observes this same account-scoped cache; no read marks responsibility. */
export function useGateStaffingAlerts() {
  const { user } = useAuth();
  const queryKey = ["gate-staffing-alerts", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, user?.role, user?.vendorRole] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => staffingRequest<GateStaffingAlertsResponse>("", { signal }),
    enabled: Boolean(user && !user.requiresContextChoice && !user.offlineOnly),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  return { ...query, queryKey, scope: JSON.stringify(queryKey) };
}

export function useAcknowledgeGateStaffingAlert(queryKey: readonly unknown[]) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => staffingRequest<{ alert: GateStaffingAlert }>(`/${encodeURIComponent(id)}/acknowledge`, {
      method: "POST", body: JSON.stringify({ channel: "web" }),
    }),
    retry: false,
    onSuccess: ({ alert }) => {
      // The returned first writer is authoritative. Never substitute the signed-in name.
      cache.setQueryData<GateStaffingAlertsResponse>(queryKey, current => current && ({
        ...current, alerts: current.alerts.map(saved => saved.id === alert.id ? alert : saved),
      }));
      void cache.invalidateQueries({ queryKey });
      void cache.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: () => { void cache.invalidateQueries({ queryKey }); },
  });
}
