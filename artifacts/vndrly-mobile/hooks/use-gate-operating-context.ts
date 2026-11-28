import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import { useGateSelection } from "@/lib/gate-selection";
import { assignedReadWithOfflineFallback } from "@/lib/native-assigned-cache";
import { OFFLINE_SIGN_IN_MS } from "@/lib/offline-sign-in";
export function useGateOperatingContext(enabled = true) {
  const { user, activeMembershipId } = useAuth();
  const view = useGateSelection(user, activeMembershipId);
  const query = useQuery({
    queryKey: [
      "gate-operating-context",
      user?.id,
      activeMembershipId,
      user?.vendorId,
      user?.partnerId,
    ],
    queryFn: () => {
      const read = () =>
        changeOverRequest<{
          operatingGate: {
            siteId: number;
            stationId: string;
            siteName: string;
            gateName: string;
          } | null;
          reason: string | null;
        }>("/operating-context");
      // No connection: the gate this device last operated keeps recording. The server rechecks access when the records upload.
      return user
        ? assignedReadWithOfflineFallback(user, "gate.operating", read, OFFLINE_SIGN_IN_MS)
        : read();
    },
    enabled: enabled && !!user?.id,
    refetchInterval: 10000,
    retry: false,
  });
  const operating = query.data?.operatingGate ?? null;
  useEffect(() => {
    if (enabled && operating && !view.selection)
      view.save(operating.siteId, operating.stationId);
  }, [enabled, operating?.siteId, operating?.stationId, view.selection]);
  return {
    ...query,
    operating,
    myGate: () => {
      if (operating) view.save(operating.siteId, operating.stationId);
    },
    canOperate: (siteId?: number | null, stationId?: string) =>
      enabled && !query.isError &&
      !query.isFetching &&
      !!operating &&
      operating.siteId === siteId &&
      operating.stationId === stationId,
    /** A spoken submit waits out the periodic refresh instead of being refused as read-only. */
    settled: async () => {
      const { data, isError } = query.isFetching ? await query.refetch({ cancelRefetch: false }) : query;
      const gate = enabled && !isError ? data?.operatingGate ?? null : null;
      return {
        operating: gate,
        canOperate: (siteId?: number | null, stationId?: string) =>
          !!gate && gate.siteId === siteId && gate.stationId === stationId,
      };
    },
  };
}
