import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import {
  readGateSelection,
  saveGateSelection,
  useGateSelection,
} from "@/lib/gate-selection";
export function useGateOperatingContext() {
  const { user } = useAuth();
  const viewing = useGateSelection(user);
  const query = useQuery({
    queryKey: [
      "gate-operating-context",
      user?.userId,
      user?.activeMembershipId,
      user?.vendorId,
      user?.partnerId,
    ],
    queryFn: () =>
      changeOverRequest<{
        operatingGate: {
          siteId: number;
          stationId: string;
          siteName: string;
          gateName: string;
        } | null;
        reason: string | null;
      }>("/operating-context"),
    enabled: !!user?.userId,
    refetchInterval: 10000,
    retry: false,
  });
  const operating = query.data?.operatingGate ?? null;
  useEffect(() => {
    if (operating && !readGateSelection(user))
      saveGateSelection(user, operating.siteId, operating.stationId);
  }, [
    operating?.siteId,
    operating?.stationId,
    user?.userId,
    user?.activeMembershipId,
  ]);
  return {
    ...query,
    operating,
    viewing,
    myGate: () => {
      if (operating)
        saveGateSelection(user, operating.siteId, operating.stationId);
    },
    canOperate: (siteId?: number, stationId?: string) =>
      !query.isError &&
      !query.isFetching &&
      !!operating &&
      operating.siteId === siteId &&
      operating.stationId === stationId,
  };
}
