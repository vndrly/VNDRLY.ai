import React from "react";
import { Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

/** Native equivalent of the shared branded check: company color and a white check mark. */
export default function FleetCheckbox({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const colors = useColors();
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} aria-checked={checked} disabled={disabled} onPress={() => onChange(!checked)} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, opacity: disabled ? 0.5 : 1 }}>
    <View style={{ width: 24, height: 24, borderWidth: 2, borderColor: colors.primary, backgroundColor: checked ? colors.primary : colors.card, borderRadius: 5, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#ffffff", fontWeight: "800", fontSize: 17 }}>{checked ? "✓" : ""}</Text></View>
    <Text style={{ color: colors.text, flex: 1 }}>{label}</Text>
  </Pressable>;
}
