import React from "react";
import { Text, View } from "react-native";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
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
    retry: (count, error) => count < 2 && !(error as { status?: number }).status,
    staleTime: 30000,
  });
  return <WorkdayControls webCard onShiftChange={onShiftChange} watchControl={
    <View style={{ width: "100%", maxWidth: 394 }}>
      {sites.isPending && <Text accessibilityLiveRegion="polite" style={{ color: "#ececec" }}>{i18n.language?.startsWith("es") ? "Cargando sitios…" : "Loading sites…"}</Text>}
      {sites.isError && <Pressable accessibilityRole="button" onPress={() => void sites.refetch()}><Text style={{ color: "#ececec" }}>{i18n.language?.startsWith("es") ? "No se pudieron cargar los sitios. Reintentar" : "Sites could not be loaded. Retry"}</Text></Pressable>}
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
