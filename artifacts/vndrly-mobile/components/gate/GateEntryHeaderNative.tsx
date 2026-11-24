import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";

export default function GateEntryHeaderNative({ title, subtitle, backLabel, statuses, onBack }: {
  title: string;
  subtitle?: string;
  backLabel: string;
  statuses: string[];
  onBack: () => void;
}) {
  const { primary } = useColors();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 3 }}>
    <SphereBackButton size={40} accessibilityLabel={backLabel} onPress={onBack} />
    <Feather name="clipboard" color={primary} size={20} />
    <View style={{ flex: 1 }}>
      <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 24, fontWeight: "700" }}>{title}</Text>
      {!!subtitle && <Text style={{ color: "#b3b3b3", fontSize: 14, marginTop: 4 }}>{subtitle}</Text>}
      {statuses.map((status, index) => <Text key={`${index}:${status}`} accessibilityRole="alert" style={{ color: primary, fontSize: 14, fontWeight: "600", marginTop: 4 }}>{status}</Text>)}
    </View>
  </View>;
}
