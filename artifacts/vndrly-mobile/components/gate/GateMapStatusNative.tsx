import React from "react";
import { Text, View } from "react-native";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type GateMapStatus = {
  id: string;
  message: string;
  actionLabel: string | null;
  actionDisabled: boolean;
  tone: "normal" | "error" | "warning";
};

export default function GateMapStatusNative({ status, onAction }: { status: GateMapStatus; onAction: () => void }) {
  const { primary } = useColors();
  const color = status.tone === "error" ? "#f87171" : status.tone === "warning" ? "#f59e0b" : "#b3b3b3";
  return <View accessibilityRole={status.tone === "error" ? "alert" : "text"} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingVertical: 3 }}>
    <Text style={{ color, fontSize: 12, flexShrink: 1 }}>{status.message}</Text>
    {status.actionLabel && <Pressable accessibilityRole="button" disabled={status.actionDisabled} onPress={onAction} style={{ borderWidth: 1, borderColor: primary, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5, opacity: status.actionDisabled ? 0.5 : 1 }}><Text style={{ color: primary, fontSize: 12 }}>{status.actionLabel}</Text></Pressable>}
  </View>;
}
