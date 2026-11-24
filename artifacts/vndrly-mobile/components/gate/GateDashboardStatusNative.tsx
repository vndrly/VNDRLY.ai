import React from "react";
import { Text, View } from "react-native";
import { ModalPressable as Pressable } from "@/components/ModalDraft";

export type GateDashboardStatus = {
  id: string;
  message: string;
  retryLabel: string;
};

export default function GateDashboardStatusNative({ status, onRetry }: { status: GateDashboardStatus; onRetry: () => void }) {
  const failed = status.id === "error";
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, minHeight: 20 }}>
    <Text accessibilityRole={failed ? "alert" : undefined} style={{ color: failed ? "#f87171" : "#ececec", fontSize: 14 }}>{status.message}</Text>
    {!!status.retryLabel && <Pressable accessibilityRole="button" accessibilityLabel={status.retryLabel} onPress={onRetry}><Text style={{ color: "#ececec", fontSize: 14, textDecorationLine: "underline" }}>{status.retryLabel}</Text></Pressable>}
  </View>;
}
