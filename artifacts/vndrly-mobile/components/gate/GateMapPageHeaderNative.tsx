import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";

export default function GateMapPageHeaderNative({ title, backLabel, onBack }: {
  title: string;
  backLabel: string;
  onBack: () => void;
}) {
  const { primary } = useColors();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 3 }}>
    <SphereBackButton size={40} accessibilityLabel={backLabel} onPress={onBack} />
    <Feather name="map-pin" size={20} color={primary} />
    <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 24, fontWeight: "700", flex: 1 }}>{title}</Text>
  </View>;
}
