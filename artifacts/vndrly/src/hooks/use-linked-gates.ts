import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { changeOverRequest } from "@/lib/change-over-api";

export type LinkedGate = { id: string; siteId: number; name: string; siteName: string; active: boolean; connection: "online" | "offline" | "unknown"; lastSeenAt: string | null };
export type LinkedGateScope = { siteIds: number[]; groupId: string | null; name: string | null; gates: LinkedGate[]; observedAt: string };
export function useLinkedGates(siteId?: number, stationId?: string, reportConnection = false) {
  const { user } = useAuth(), cache = useQueryClient();
  const identity = [user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId];
  const query = useQuery({
    queryKey: ["linked-gates", ...identity, siteId],
    queryFn: () => changeOverRequest<LinkedGateScope>(`/linked-gates?siteId=${siteId}`),
    enabled: Boolean(siteId && user?.userId), retry: false, refetchInterval: 30_000,
  });
  useEffect(() => {
    if (!reportConnection || !stationId || !user?.userId) return;
    let current = true, pending = false;
    const pulse = async () => {
      if (!current || pending || !navigator.onLine || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await changeOverRequest<{recorded: boolean}>(`/${stationId}/connection`, {});
        if (current && result.recorded) void cache.invalidateQueries({queryKey:["linked-gates"]});
      } catch { /* Failed reports expire naturally; never manufacture an online state. */ }
      finally { pending = false; }
    };
    void pulse(); const timer = setInterval(() => void pulse(), 30_000);
    const onVisible = () => void pulse(); document.addEventListener("visibilitychange", onVisible);
    return () => { current = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [reportConnection, stationId, ...identity]);
  return query;
}
