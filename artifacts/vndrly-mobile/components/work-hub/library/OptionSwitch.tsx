import React from "react";
import { Platform, Switch, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
export default function OptionSwitch({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Text style={{ color: colors.text, flex: 1 }}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.mutedForeground, true: colors.primary }}
        thumbColor="#e5e7eb"
        {...(Platform.OS === "web" ? { activeThumbColor: "#e5e7eb" } : {})}
        style={{ width: 48, height: 28 }}
      />
    </View>
  );
}
