import React from "react";
import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import AuthedImage from "@/components/AuthedImage";

export type GateLiveFlashData = {
  message: string;
  detail: string;
  photo: string;
  status: "connecting" | "live" | "reconnecting" | "refreshed";
  statusLabel: string;
  refreshLabel: string;
};

export default function GateLiveFlashNative({ data, onRefresh }: { data: GateLiveFlashData; onRefresh: () => void }) {
  const color = data.status === "reconnecting" ? "#ef4444" : data.status === "connecting" ? "#f59e0b" : "#16a34a";
  return <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderWidth: 2, borderColor: "#f59e0b", borderRadius: 12, backgroundColor: "#fef3c7" }}>
    {data.photo ? <AuthedImage uri={data.photo} resizeMode="cover" style={{ width: 96, height: 64, borderRadius: 6 }} fallback={<Feather name="shield" size={40} color="#252525" />} /> : <Feather name="shield" size={40} color="#252525" />}
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ color: "#252525", fontSize: 18, lineHeight: 22, fontWeight: "700" }}>{data.message}</Text>
      {!!data.detail && <Text numberOfLines={1} style={{ color: "#666", fontSize: 14, marginTop: 4 }}>{data.detail}</Text>}
    </View>
    <Pressable accessibilityRole={data.status === "reconnecting" ? "button" : undefined} accessibilityLabel={data.status === "reconnecting" ? data.refreshLabel : data.statusLabel} disabled={data.status !== "reconnecting"} onPress={onRefresh} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color, fontSize: 12 }}>{data.statusLabel}</Text>
      {data.status === "reconnecting" && <Feather name="refresh-cw" size={12} color={color} />}
    </Pressable>
  </View>;
}
