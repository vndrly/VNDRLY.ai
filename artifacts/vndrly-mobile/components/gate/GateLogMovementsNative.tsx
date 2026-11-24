import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import GateAreaTraffic from "@/components/GateAreaTraffic";

export default function GateLogMovementsNative({ siteId, gateId, expanded, onToggle }: { siteId: number; gateId: string; expanded: boolean; onToggle: () => void }) {
  const { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language?.startsWith("es") ? es : en;
  return <View style={{ borderTopWidth: 1, borderTopColor: "#3a3a3a", borderBottomWidth: 1, borderBottomColor: "#3a3a3a" }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}><Feather name={expanded ? "chevron-down" : "chevron-right"} size={14} color="#d8d8d8" /><Text style={{ color: "#f4f4f4", fontSize: 14, fontWeight: "600", flex: 1 }}>{c("Current site movements (separate from the report)", "Movimientos actuales del sitio (separados del informe)")}</Text></Pressable>
    {expanded && <View style={{ gap: 12, paddingBottom: 12 }}><Text style={{ color: "#aaa", fontSize: 12 }}>{c("Live operations. Report date, search and export filters below do not apply to this section.", "Operaciones en vivo. Los filtros de fecha, búsqueda y exportación no se aplican a esta sección.")}</Text><GateAreaTraffic siteId={siteId} gateId={gateId} history /></View>}
  </View>;
}
