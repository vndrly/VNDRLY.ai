import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import { useGateSelection } from "@/lib/gate-selection";
export function useGateOperatingContext() {
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
    enabled: !!user?.id,
    refetchInterval: 10000,
    retry: false,
  });
  const operating = query.data?.operatingGate ?? null;
  useEffect(() => {
    if (operating && !view.selection)
      view.save(operating.siteId, operating.stationId);
  }, [operating?.siteId, operating?.stationId, view.selection]);
  return {
    ...query,
    operating,
    myGate: () => {
      if (operating) view.save(operating.siteId, operating.stationId);
    },
    canOperate: (siteId?: number | null, stationId?: string) =>
      !query.isError &&
      !query.isFetching &&
      !!operating &&
      operating.siteId === siteId &&
      operating.stationId === stationId,
  };
}
