import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";
import type { GateArrivalDetail } from "@workspace/api-zod";

export type GateLogArrival = {
  id: string;
  runId: string;
  siteId: number;
  name: string;
  description: string;
  status: string;
  flags: { key: string; label: string; title: string }[];
  footer: string | null;
  detail: string;
  eta: string;
  actionLabel: string | null;
  isNew: boolean;
  previewDetail?: GateArrivalDetail | null;
};

export default function GateLogArrivalNative({ arrival, onOpen, onAction }: { arrival: GateLogArrival; onOpen: () => void; onAction: () => void }) {
  const { primary } = useColors();
  return <View accessibilityLabel={arrival.name} style={{ borderColor: arrival.isNew ? primary : "#555", borderWidth: 1, borderRadius: 7, backgroundColor: "#242426" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={arrival.name} onPress={onOpen} style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}><Text style={{ color: "#ececec", fontSize: 14, fontWeight: "700", flex: 1 }}>{arrival.name}</Text><Text style={{ color: "#ececec", fontSize: 12 }}>{arrival.status}</Text></View>
      {!!arrival.description && <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{arrival.description}</Text>}
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{arrival.detail}</Text><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{arrival.eta}</Text></View>
    </Pressable>
    {(arrival.flags.length > 0 || arrival.footer || arrival.actionLabel) && <View style={{ borderTopWidth: 1, borderTopColor: "#3a3a3a", paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1, gap: 3 }}>{arrival.flags.map(flag => <View key={flag.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Feather name="alert-triangle" size={13} color="#f59e0b" /><Text style={{ color: "#ececec", fontSize: 12 }}>{flag.label}</Text></View>)}{!!arrival.footer && <Text style={{ color: "#b3b3b3", fontSize: 12 }}>{arrival.footer}</Text>}</View>
      {!!arrival.actionLabel && <Pressable accessibilityRole="button" onPress={onAction} style={{ borderColor: primary, borderWidth: 1, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6 }}><Text style={{ color: "#ececec", fontSize: 12 }}>{arrival.actionLabel}</Text></Pressable>}
    </View>}
  </View>;
}
