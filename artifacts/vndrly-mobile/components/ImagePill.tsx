import React from "react";
import { Text, View, type ViewStyle } from "react-native";
import Pill9Slice from "./Pill9Slice";
import { TEXT_SHADOW } from "@/lib/pill-doctrine";

export type ImagePillColor = "red" | "amber" | "green" | "blue" | "grey";
const sources = {
  red: require("@/assets/pill-stack/mid-red.png"),
  amber: require("@/assets/pill-stack/mid-orange.png"),
  green: require("@/assets/pill-stack/mid-green.png"),
  blue: require("@/assets/pill-stack/mid-blue.png"),
  grey: require("@/assets/pill-stack/light-grey.png"),
} as const;

/** Read-only status chip using the same cap-preserving PNG treatment as TogglePillButton. */
export default function ImagePill({ color, children, accessibilityLabel, style }: { color: ImagePillColor; children: React.ReactNode; accessibilityLabel: string; style?: ViewStyle }) {
  const light = color === "grey";
  return <View accessibilityRole="text" accessibilityLabel={accessibilityLabel} style={[{ alignSelf: "flex-start", minHeight: 32, minWidth: 76, paddingHorizontal: 14, justifyContent: "center", alignItems: "center", borderRadius: 999, overflow: "hidden" }, style]}>
    <Pill9Slice source={sources[color]} height={32} borderRadius={16} />
    <Text style={{ color: light ? "#111827" : "#ffffff", fontWeight: "800", fontSize: 12, ...(light ? {} : TEXT_SHADOW.deep) }}>{children}</Text>
  </View>;
}
