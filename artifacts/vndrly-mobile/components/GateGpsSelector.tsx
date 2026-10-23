import React, { useId } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

/** Optional device evidence: the chosen gate remains authoritative. */
export default function GateGpsSelector({ children, status, label }: {
  children: React.ReactNode; status: "verified" | "mismatch" | "unavailable"; label: string;
}) {
  const gradient = `gate-gps-${useId().replace(/:/g, "")}`;
  const endpoint = status === "verified" ? "#22c55e" : status === "mismatch" ? "#ef4444" : "#9ca3af";
  return <View testID="gate-gps-indicator" accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center" }}>
    <View style={{ flex: 1 }}>{children}</View>
    <Svg width={32} height={52} viewBox="0 0 32 52" accessible={false}>
      <Defs><LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#f59e0b" /><Stop offset="100%" stopColor={endpoint} /></LinearGradient></Defs>
      <Path d="M 5 4 A 22 22 0 0 1 5 48" fill="none" stroke="#151719" strokeWidth={8} strokeLinecap="round" />
      <Path d="M 5 4 A 22 22 0 0 1 5 48" fill="none" stroke={`url(#${gradient})`} strokeWidth={5} strokeLinecap="round" />
    </Svg>
  </View>;
}
