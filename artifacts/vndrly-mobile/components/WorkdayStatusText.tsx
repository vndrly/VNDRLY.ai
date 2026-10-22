import React from "react";
import { Pressable, Text } from "react-native";

export default function WorkdayStatusText({ active, disabled, label, onPress }: { active: boolean; disabled?: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={{ minHeight: 40, justifyContent: "center", paddingVertical: 4 }}><Text style={{ color: active ? "#22c55e" : "#9ca3af", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>{label}</Text></Pressable>;
}
