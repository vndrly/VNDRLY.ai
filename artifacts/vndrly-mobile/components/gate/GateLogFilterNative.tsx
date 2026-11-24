import React from "react";
import { Text, View } from "react-native";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type GateLogView = "arrivals" | "on_site" | "departures" | "all";

const views: { key: GateLogView; label: string }[] = [
  { key: "arrivals", label: "Arrivals" },
  { key: "on_site", label: "On Site" },
  { key: "departures", label: "Departures" },
  { key: "all", label: "All" },
];

export default function GateLogFilterNative({ selected, onSelect }: { selected: GateLogView; onSelect: (view: GateLogView) => void }) {
  const { primary } = useColors();
  return <View accessibilityLabel="Gate activity filters" style={{ flexDirection: "row", gap: 8 }}>
    {views.map(view => <Pressable key={view.key} accessibilityRole="button" accessibilityState={{ selected: selected === view.key }} onPress={() => onSelect(view.key)}
      style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: selected === view.key ? primary : "#626268", borderRadius: 8, backgroundColor: "#28282a", paddingHorizontal: 4, alignItems: "center", justifyContent: "center" }}>
      <Text numberOfLines={1} style={{ color: selected === view.key ? primary : "#b3b3b3", fontSize: 14, fontWeight: "600" }}>{view.label}</Text>
    </Pressable>)}
  </View>;
}
