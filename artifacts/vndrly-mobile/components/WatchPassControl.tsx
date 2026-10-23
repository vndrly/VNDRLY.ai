import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/** Matches the web watch-key action without suggesting on/off custody. */
export default function WatchPassControl({ active, disabled, label, onPress }: { active: boolean; disabled?: boolean; label: string; onPress: () => void }) {
  const color = active ? "#22c55e" : "#9ca3af";
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ minHeight: 44, maxWidth: "100%", flexShrink: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
    <View accessible={false} style={{ flexShrink: 0, flexDirection: active ? "row" : "row-reverse", alignItems: "center", gap: 4 }}><Ionicons name="key-outline" size={23} color={color} /><Ionicons name="arrow-forward" size={18} color={color} /></View>
    <Text style={{ flexShrink: 1, textAlign: "center", color, fontFamily: "Inter_700Bold", fontSize: 17 }}>{label}</Text>
  </Pressable>;
}
