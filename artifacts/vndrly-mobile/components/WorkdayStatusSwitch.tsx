import React from "react";
import { Pressable, Text, View } from "react-native";

/** Duty stays server-owned; the slider reflects only the supplied state. */
export default function WorkdayStatusSwitch({ active, disabled, label, accessibilityLabel = label, onPress }: { active: boolean; disabled?: boolean; label: string; accessibilityLabel?: string; onPress: () => void }) {
  return <Pressable aria-checked={active} aria-disabled={Boolean(disabled)} accessibilityRole="switch" accessibilityLabel={accessibilityLabel} accessibilityState={{ checked: active, disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={{ minHeight: 44, flexShrink: 1, flexDirection: "column", alignItems: "center", gap: 4, paddingVertical: 4 }}>
    <Text style={{ flexShrink: 1, textAlign: "center", color: active ? "#22c55e" : "#9ca3af", fontFamily: "Inter_700Bold", fontSize: 17 }}>{label}</Text>
    <View accessible={false} style={{ flexShrink: 0, width: 44, height: 24, borderRadius: 12, padding: 3, backgroundColor: active ? "#22c55e" : "#6b7280", alignItems: active ? "flex-end" : "flex-start" }}><View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: "#ffffff" }} /></View>
  </Pressable>;
}
