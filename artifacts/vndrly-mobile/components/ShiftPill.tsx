import React from "react";
import { Text, useWindowDimensions } from "react-native";
import LayeredPillButton from "./LayeredPillButton";
export default function ShiftPill({ active, disabled, label, onPress, compact = false }: { active: boolean; disabled: boolean; label: string; onPress: () => void; compact?: boolean }) {
  const { width } = useWindowDimensions();
  return <LayeredPillButton inactive={!active} accessibilityState={{ selected: active, disabled }} source={active ? require("@/assets/pills/pill_green_approval1.png") : undefined} disabled={disabled} onPress={onPress} style={{ flex: compact || width >= 768 ? 0 : 1, minWidth: compact ? 120 : width >= 768 ? 160 : 130, maxWidth: compact ? 180 : width >= 768 ? 240 : undefined }}><Text style={{ color: active ? "#ffffff" : "#1a1d23", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>{label}</Text></LayeredPillButton>;
}
