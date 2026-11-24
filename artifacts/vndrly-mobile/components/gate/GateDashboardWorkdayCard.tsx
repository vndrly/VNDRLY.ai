import React from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import WorkdayControls from "@/components/WorkdayControls";
import GateSiteGateSelect from "@/components/GateSiteGateSelect";

export default function GateDashboardWorkdayCard({ siteId, stationId, gateName, onSelection, onShiftChange }: {
  siteId: number;
  stationId: string;
  gateName: string;
  onSelection: (siteId: number, stationId: string) => void;
  onShiftChange: (active: boolean) => void;
}) {
  const { user, activeMembershipId } = useAuth();
  const { i18n } = useTranslation();
  const sites = useQuery({
    queryKey: ["gate-native-workday-sites", user?.id, activeMembershipId],
    queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/sites"),
    enabled: Boolean(user),
    retry: false,
    staleTime: 30000,
  });
  return <WorkdayControls webCard onShiftChange={onShiftChange} watchControl={
    <View style={{ width: "100%" }}>
      <GateSiteGateSelect
        compact
        allOptionLabel={i18n.language?.startsWith("es") ? "Todos los accesos" : "All gates"}
        sites={sites.data?.sites ?? []}
        siteId={siteId}
        gate={stationId ? { id: stationId, name: gateName } : undefined}
        onChange={onSelection}
      />
    </View>
  } />;
}
