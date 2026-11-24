import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";

export default function GateLogHeaderNative({ title, subtitle, backLabel, onBack }: { title: string; subtitle: string; backLabel: string; onBack: () => void }) {
  const { primary } = useColors();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 5 }}>
    <SphereBackButton onPress={onBack} accessibilityLabel={backLabel} size={40} />
    <Feather name="rotate-ccw" size={20} color={primary} />
    <View style={{ flex: 1 }}>
      <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 24, fontWeight: "700" }}>{title}</Text>
      <Text style={{ color: "#b3b3b3", fontSize: 14, marginTop: 3 }}>{subtitle}</Text>
    </View>
  </View>;
}
