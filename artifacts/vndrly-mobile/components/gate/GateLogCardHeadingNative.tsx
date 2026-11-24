import React from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

export default function GateLogCardHeadingNative({ title }: { title: string }) {
  return <View style={{ padding: 24, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Feather name="map-pin" color="#08b5d5" size={18} />
    <Text style={{ color: "#f6f6f6", fontSize: 17, fontWeight: "600", letterSpacing: -0.2 }}>{title}</Text>
  </View>;
}
