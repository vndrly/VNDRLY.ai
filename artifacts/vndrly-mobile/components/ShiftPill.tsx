import React from "react";
import { Text, useWindowDimensions } from "react-native";
import LayeredPillButton from "./LayeredPillButton";
export default function ShiftPill({ active, disabled, label, onPress }: { active: boolean; disabled: boolean; label: string; onPress: () => void }) {
  const { width } = useWindowDimensions();
  return <LayeredPillButton inactive={!active} source={active ? require("@/assets/pills/pill_green_approval1.png") : undefined} disabled={disabled} onPress={onPress} style={{ flex: width >= 768 ? 0 : 1, minWidth: width >= 768 ? 160 : 130, maxWidth: width >= 768 ? 240 : undefined }}><Text style={{ color: active ? "#ffffff" : "#1a1d23", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>{label}</Text></LayeredPillButton>;
}
