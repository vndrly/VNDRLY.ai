import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import {
  readGateSelection,
  saveGateSelection,
  useGateSelection,
} from "@/lib/gate-selection";
import { gateReadWithOfflineFallback } from "@/lib/gate-offline-store";
export function useGateOperatingContext() {
  const { user } = useAuth();
  const viewing = useGateSelection(user);
  const unreachable = useRef(false);
  const query = useQuery({
    queryKey: [
      "gate-operating-context",
      user?.userId,
      user?.activeMembershipId,
      user?.vendorId,
      user?.partnerId,
    ],
    queryFn: async () => {
      let reached = true;
      const read = () =>
        changeOverRequest<{
          operatingGate: {
            siteId: number;
            stationId: string;
            siteName: string;
            gateName: string;
          } | null;
          reason: string | null;
        }>("/operating-context").catch((error) => { reached = false; throw error; });
      // No connection: the gate this computer last operated keeps recording. The server rechecks access when the records upload.
      const value = await (user ? gateReadWithOfflineFallback(user, "gate.operating", read) : read());
      unreachable.current = !reached;
      return value;
    },
    // Runs with no connection too, so the kept copy can answer.
    networkMode: "always",
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
      // With no connection the re-check never finishes, and it must not hold the gate closed.
      (!query.isFetching || unreachable.current) &&
      !!operating &&
      operating.siteId === siteId &&
      operating.stationId === stationId,
  };
}
