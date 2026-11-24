import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import GateSiteGateSelect from "@/components/GateSiteGateSelect";

export default function GateMapHeaderNative({ sites, siteId, gateId, gateName, showTitle, showSelector, onSelect }: {
  sites: { id: number; name: string }[];
  siteId: number;
  gateId: string;
  gateName: string;
  showTitle: boolean;
  showSelector: boolean;
  onSelect: (gateId: string) => void;
}) {
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const es = i18n.language?.startsWith("es");
  return <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
    {showTitle && <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Feather name="map-pin" size={20} color={primary} />
      <Text accessibilityRole="header" style={{ color: "#f4f4f4", fontSize: 18, fontWeight: "700" }}>{es ? "Mapa de accesos" : "Gate Map"}</Text>
    </View>}
    {showSelector && <View style={{ minWidth: 190, flex: 1 }}><GateSiteGateSelect sites={sites} siteId={siteId} gate={gateId ? { id: gateId, name: gateName } : undefined} allOptionLabel={es ? "Todos" : "All"} onChange={(_siteId, nextGateId) => onSelect(nextGateId)} /></View>}
  </View>;
}
