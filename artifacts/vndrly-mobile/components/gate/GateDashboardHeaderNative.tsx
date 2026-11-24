import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import SphereBackButton from "@/components/SphereBackButton";
import { pageBack } from "@/lib/page-back";
import { useColors } from "@/hooks/useColors";

export default function GateDashboardHeaderNative({ title, subtitle, onReport }: { title: string; subtitle: string; onReport: () => void }) {
  const { primary } = useColors();
  return <View style={{ gap: 5, paddingHorizontal: 2, paddingTop: 3, paddingBottom: 6 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <SphereBackButton onPress={() => pageBack()} size={40} />
      <Feather name="grid" color={primary} size={20} />
      <Text accessibilityRole="header" numberOfLines={2} style={{ color: "#ececec", fontSize: 21, fontWeight: "700", flex: 1 }}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Report an incident" onPress={onReport} style={{ borderColor: primary, borderWidth: 1, borderRadius: 8, minHeight: 42, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 }}><Feather name="shield" color="#f04444" size={16} /><Text style={{ color: "#ececec", fontSize: 12, fontWeight: "600" }}>Report an incident</Text></Pressable>
    </View>
    <Text style={{ color: "#b3b3b3", fontSize: 13, paddingLeft: 13 }}>{subtitle}</Text>
  </View>;
}
